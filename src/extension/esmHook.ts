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
}

// The ESM hooks are process-wide singletons. The owner context is replaced on
// every loader initialization so the latest coc.nvim manager owns
// `import ... from "coc.nvim"` resolution, matching the Module._load wrapper
// semantics. Production runs exactly one manager.
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

function findOwner(filename: string, ctx: OwnerContext): { id: string; api: object } {
  const extension = ctx.paths.findByFile(filename)
  if (extension) {
    return { id: `ext:${extension.id}`, api: ctx.apiFactory.getApi(extension) }
  }
  if (isInside(ctx.cocRoot, filename)) {
    return { id: 'core', api: ctx.apiFactory.getCoreApi() }
  }
  throw new Error(
    'Cannot resolve "coc.nvim" API owner.\n\n' +
    `Importer:\n  ${filename}\n\n` +
    'The importing module does not belong to coc.nvim core or a registered extension.'
  )
}

/**
 * Install process-wide ESM hooks that map `import ... from "coc.nvim"` to the
 * importing extension's API.
 *
 * Only the exact specifier `coc.nvim` is special-cased. The virtual module is
 * keyed by owner id, so all ESM files of one extension share one module
 * instance (and therefore one API object) while different extensions get
 * different objects. Hooks are installed once for the process lifetime.
 */
export function installEsmHooks(
  paths: ExtensionPathIndex,
  apiFactory: ExtensionApiFactory<object, object>,
  cocRoot: string
): void {
  ownerContext = { paths, apiFactory, cocRoot }
  if (hooksInstalled) return
  hooksInstalled = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== 'coc.nvim') {
        return nextResolve(specifier, context)
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
      return {
        format: 'module',
        source: buildSource(url, api),
        shortCircuit: true
      }
    }
  })
}

function buildSource(url: string, api: object): string {
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
