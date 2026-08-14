'use strict'
import { pathToFileURL } from 'url'
import type { ExtensionModuleDescription } from './pathIndex'

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
  return packageJson?.type === 'module' ? 'module' : 'commonjs'
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
    const exported = isNamespace && (raw as { default?: unknown }).default !== undefined
      ? (raw as { default?: unknown }).default
      : raw
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
 * The process-wide `Module._load` interceptor must be installed before this
 * is called so `require("coc.nvim")` inside the extension resolves to the
 * owning extension's API.
 */
export function loadExtensionModule(extension: ExtensionModuleDescription): ExtensionExports {
  try {
    const raw = require(extension.entry)
    return normalizeExtensionExports(raw)
  } catch (error) {
    if (error instanceof ExtensionLoadError) throw error
    throw new ExtensionLoadError(extension.id, extension.entry, { cause: error })
  }
}

/**
 * Load an extension entry through native Node.js loading, dispatching on the
 * entry's module system. CommonJS entries use `require()`; ESM entries use
 * `import()`. ESM loading requires the process-wide `coc.nvim` ESM hooks to
 * be installed so `import ... from "coc.nvim"` resolves by importer ownership.
 */
export async function loadExtensionModuleAsync(
  extension: ExtensionModuleDescription
): Promise<ExtensionExports> {
  try {
    if (extension.moduleType === 'module') {
      const mod = await import(pathToFileURL(extension.entry).href)
      return normalizeExtensionExports(mod)
    }
    return loadExtensionModule(extension)
  } catch (error) {
    if (error instanceof ExtensionLoadError) throw error
    throw new ExtensionLoadError(extension.id, extension.entry, { cause: error })
  }
}
