'use strict'
import type { ExtensionModuleDescription } from './pathIndex'

export interface ExtensionExports {
  activate: (context: unknown) => unknown
  deactivate?: () => unknown
  [key: string]: any
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
 * Normalize raw CommonJS exports into the coc.nvim extension contract.
 *
 * Preserves current factory semantics exactly:
 * - a function export is the activate function;
 * - an object with a function `activate` is copied as-is (including
 *   `deactivate` and any extra exports);
 * - any other exported value yields a no-op activate function.
 */
export function normalizeExtensionExports(raw: unknown): ExtensionExports {
  if (typeof raw === 'function') {
    return { activate: raw as (context: unknown) => unknown }
  }
  if (raw && typeof raw === 'object') {
    const activate = (raw as { activate?: unknown }).activate
    if (typeof activate === 'function') {
      return Object.assign({}, raw) as ExtensionExports
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
