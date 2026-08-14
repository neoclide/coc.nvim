'use strict'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'url'
import type { ExtensionApiFactory } from './apiFactory'
import { isInside, type ExtensionPathIndex } from './pathIndex'

const registrySymbol = Symbol.for('coc.nvim.internal.extensionApiRegistry')
const VIRTUAL_PREFIX = 'coc-virtual:coc.nvim?'

interface OwnerContext {
  paths: ExtensionPathIndex
  apiFactory: ExtensionApiFactory<object, object>
  cocRoot: string
  externalDependencies: Set<string>
  knownModules: Set<string>
}

// The hooks are process-wide singletons. The owner context is replaced on
// every loader initialization so the latest coc.nvim manager owns
// `coc.nvim` resolution. Production runs exactly one manager.
let ownerContext: OwnerContext | undefined
let hooksInstalled = false

function registry(): Map<string, object> {
  let map = (globalThis as any)[registrySymbol]
  if (!map) {
    map = new Map<string, object>()
    Object.defineProperty(globalThis, registrySymbol, {
      value: map,
      configurable: true,
      writable: true
    })
  }
  return map
}

function virtualUrl(id: string): string {
  return `${VIRTUAL_PREFIX}id=${encodeURIComponent(id)}`
}

/**
 * Drop the cached `require("coc.nvim")` module for one extension. CommonJS
 * caches the virtual module under its owner URL, so reload must clear that
 * entry for the recreated API object to be observed again. ESM reloads do not
 * re-execute module code, so there is nothing to invalidate for `import`.
 */
export function invalidateExtensionCocModule(extensionId: string): void {
  const url = virtualUrl(`ext:${extensionId}`)
  delete require.cache[url]
  registry().delete(url)
}

function findOwner(filename: string, ctx: OwnerContext): { id: string; api: object } {
  const extension = ctx.paths.findByFile(filename)
  if (extension) {
    return { id: `ext:${extension.id}`, api: ctx.apiFactory.getApi(extension) }
  }
  if (isInside(ctx.cocRoot, filename)) {
    return { id: 'core', api: ctx.apiFactory.getCoreApi() }
  }
  if (ctx.externalDependencies.has(filename)) {
    // Hoisted and workspace dependencies can be shared by several extensions,
    // so assigning them to the first importer would make ownership depend on
    // load order. Keep the legacy shared API for those external modules.
    return { id: `external:${filename}`, api: ctx.apiFactory.getCoreApi() }
  }
  throw new Error(
    'Cannot resolve "coc.nvim" API owner.\n\n' +
    `Importer:\n  ${filename}\n\n` +
    'The importing module does not belong to coc.nvim core or a registered extension.'
  )
}

/**
 * Install process-wide Node module hooks that map both `require("coc.nvim")`
 * and `import ... from "coc.nvim"` to the importing extension's API.
 *
 * Only the exact specifier `coc.nvim` is special-cased. The virtual module is
 * keyed by owner id, so all files of one extension share one module instance
 * (and therefore one API object) while different extensions get different
 * objects. Hooks are installed once for the process lifetime; subsequent
 * calls only replace the owner context.
 */
export function installCocModuleHooks(
  paths: ExtensionPathIndex,
  apiFactory: ExtensionApiFactory<object, object>,
  cocRoot: string
): void {
  ownerContext = {
    paths,
    apiFactory,
    cocRoot,
    externalDependencies: new Set(),
    knownModules: new Set()
  }
  if (hooksInstalled) return
  hooksInstalled = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== 'coc.nvim') {
        const result = nextResolve(specifier, context)
        const ctx = ownerContext
        if (ctx) trackExternalDependency(context.parentURL, result.url, ctx)
        return result
      }
      const parentUrl = context.parentURL
      if (!parentUrl) {
        throw new Error('Cannot resolve "coc.nvim" API owner: parent module is missing')
      }
      const ctx = ownerContext
      if (!ctx) {
        throw new Error('Cannot resolve "coc.nvim" API owner: extension loader is not initialized')
      }
      let filename: string
      try {
        filename = fileURLToPath(parentUrl)
      } catch (e) {
        throw new Error(
          'Cannot resolve "coc.nvim" API owner.\n\n' +
          `Importer:\n  ${parentUrl}\n\n` +
          'The importing module is not a file module.'
        )
      }
      const { id, api } = findOwner(filename, ctx)
      const url = virtualUrl(id)
      registry().set(url, api)
      return { url, shortCircuit: true }
    },
    load(url, context, nextLoad) {
      if (!url.startsWith(VIRTUAL_PREFIX)) {
        return nextLoad(url, context)
      }
      const api = registry().get(url)
      if (!api) {
        throw new Error(`Cannot resolve "coc.nvim" API for virtual module: ${url}`)
      }
      const commonJs = context.conditions.includes('require')
      return {
        format: commonJs ? 'commonjs' : 'module',
        source: commonJs ? buildCommonJsSource(url) : buildModuleSource(url, api),
        shortCircuit: true
      }
    }
  })
}

function trackExternalDependency(parentUrl: string | undefined, resolvedUrl: string, ctx: OwnerContext): void {
  if (!parentUrl) return
  let parent: string
  let resolved: string
  try {
    parent = fileURLToPath(parentUrl)
    resolved = fileURLToPath(resolvedUrl)
  } catch (e) {
    return
  }
  const knownParent = ctx.knownModules.has(parent) || ctx.paths.findByFile(parent) != null ||
    isInside(ctx.cocRoot, parent) || ctx.externalDependencies.has(parent)
  if (!knownParent) return
  ctx.knownModules.add(parent)
  if (ctx.paths.findByFile(resolved) || isInside(ctx.cocRoot, resolved)) {
    ctx.knownModules.add(resolved)
    return
  }
  ctx.externalDependencies.add(resolved)
  ctx.knownModules.add(resolved)
}

function buildCommonJsSource(url: string): string {
  const symbol = JSON.stringify(registrySymbol.description)
  const key = JSON.stringify(url)
  return `module.exports = globalThis[Symbol.for(${symbol})].get(${key})`
}

function buildModuleSource(url: string, api: object): string {
  const lines = [
    `const __cocApi = globalThis[Symbol.for(${JSON.stringify(registrySymbol.description)})].get(${JSON.stringify(url)})`,
    'export default __cocApi'
  ]
  for (const key of Object.keys(api)) {
    if (key === 'default') continue
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) continue
    lines.push(`export const ${key} = __cocApi[${JSON.stringify(key)}]`)
  }
  return lines.join('\n')
}
