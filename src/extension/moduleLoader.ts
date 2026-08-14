'use strict'
import { findPackageJSON } from 'node:module'
import { pathToFileURL } from 'url'
import { createLogger } from '../logger'
import { fs } from '../util/node'
import type { ExtensionModuleDescription } from './pathIndex'

const logger = createLogger('extension-loader')

export interface ExtensionExports {
  activate: (context: unknown) => unknown
  deactivate?: () => unknown
  [key: string]: any
}

export interface ExtensionPackageJson {
  type?: string
  [key: string]: any
}

/**
 * Decide the module system of an extension entry from its filename and the
 * nearest package.json `type` field, following Node.js resolution rules.
 */
export function getModuleType(
  packageJson: ExtensionPackageJson | undefined,
  entry: string
): ExtensionModuleDescription['moduleType'] {
  if (entry.endsWith('.mjs')) return 'module'
  if (entry.endsWith('.cjs')) return 'commonjs'
  const packageType = getNearestPackageType(entry) ?? packageJson?.type
  return packageType === 'module' ? 'module' : 'commonjs'
}

function getNearestPackageType(entry: string): string | undefined {
  try {
    const packageFile = findPackageJSON(pathToFileURL(entry).href)
    if (!packageFile) return undefined
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
    return typeof packageJson?.type === 'string' ? packageJson.type : undefined
  } catch (e) {
    // Loading reports missing or invalid package metadata with extension
    // context. Keep the provided package metadata as the fallback here.
    return undefined
  }
}

/**
 * Load failure with extension metadata. The original error stays inspectable
 * through the `cause` chain, including its stack.
 */
export class ExtensionLoadError extends Error {
  public readonly extensionId: string
  public readonly entry: string

  constructor(extensionId: string, entry: string, options: { cause?: unknown }) {
    super(`Failed to load extension ${extensionId} from ${entry}`, options)
    this.name = 'ExtensionLoadError'
    this.extensionId = extensionId
    this.entry = entry
  }
}

/**
 * Normalize raw module exports into the coc.nvim extension contract.
 *
 * Preserves current factory semantics exactly:
 * - a function export is the activate function;
 * - an object with a function `activate` is copied as-is (including
 *   `deactivate` and any extra exports);
 * - an ESM namespace whose default export is the activate function or an
 *   object with a function `activate` follows the same rules;
 * - any other exported value yields a no-op activate function.
 */
export function normalizeExtensionExports(raw: unknown): ExtensionExports {
  if (typeof raw === 'function') {
    return { activate: raw as (context: unknown) => unknown }
  }
  if (raw && typeof raw === 'object') {
    const isNamespace = Object.prototype.toString.call(raw) === '[object Module]'
    if (isNamespace) {
      const namespace = raw as { activate?: unknown; default?: unknown }
      if (typeof namespace.activate === 'function') {
        return Object.assign({}, namespace) as ExtensionExports
      }
      const defaultExport = namespace.default
      if (typeof defaultExport === 'function') {
        return Object.assign({}, namespace, { activate: defaultExport }) as ExtensionExports
      }
      if (defaultExport && typeof defaultExport === 'object' &&
        typeof (defaultExport as { activate?: unknown }).activate === 'function') {
        return Object.assign({}, namespace, defaultExport) as ExtensionExports
      }
      return { activate: () => {} }
    }
    const exported = raw
    if (typeof exported === 'function') {
      return { activate: exported as (context: unknown) => unknown }
    }
    const activate = (exported as { activate?: unknown }).activate
    if (typeof activate === 'function') {
      return Object.assign({}, exported) as ExtensionExports
    }
  }
  return { activate: () => {} }
}

/**
 * Execute an extension entry through Node's native CommonJS loader.
 *
 * The process-wide `node:module` hooks must be installed before this is
 * called so `require("coc.nvim")` inside the extension resolves to the owning
 * extension's API.
 */
export function loadExtensionModule(extension: ExtensionModuleDescription): ExtensionExports {
  try {
    const raw = require(extension.entry)
    const exports = normalizeExtensionExports(raw)
    logger.info(`load extension ${extension.id} (${extension.moduleType}) from ${extension.entry}`)
    return exports
  } catch (error) {
    logger.error(`load extension ${extension.id} (${extension.moduleType}) from ${extension.entry} failed`, error)
    if (error instanceof ExtensionLoadError) throw error
    throw new ExtensionLoadError(extension.id, extension.entry, { cause: error })
  }
}

/**
 * Load an extension entry through native Node.js loading, dispatching on the
 * entry's module system. CommonJS entries use `require()`; ESM entries use
 * `import()`. ESM loading requires the process-wide `coc.nvim` module hooks
 * to be installed so `import ... from "coc.nvim"` resolves by importer
 * ownership.
 */
export async function loadExtensionModuleAsync(
  extension: ExtensionModuleDescription
): Promise<ExtensionExports> {
  try {
    if (extension.moduleType === 'module') {
      const mod = await import(pathToFileURL(extension.entry).href)
      const exports = normalizeExtensionExports(mod)
      logger.info(`load extension ${extension.id} (module) from ${extension.entry}`)
      return exports
    }
    return loadExtensionModule(extension)
  } catch (error) {
    if (extension.moduleType === 'module') {
      logger.error(`load extension ${extension.id} (module) from ${extension.entry} failed`, error)
    }
    if (error instanceof ExtensionLoadError) throw error
    throw new ExtensionLoadError(extension.id, extension.entry, { cause: error })
  }
}
