'use strict'
import { path } from '../util/node'
import { isInside, type ExtensionModuleDescription } from './pathIndex'

/**
 * Clears CommonJS cache entries owned by one extension.
 *
 * A cached module is owned by an extension when its resolved filename is
 * inside the extension root. Both the logical and the resolved root are
 * matched, mirroring `ExtensionPathIndex` lookup domains.
 */
export class ExtensionModuleCache {
  public clear(extension: ExtensionModuleDescription, cocRoot: string): void {
    validateCacheRoot(extension.root, cocRoot)
    validateCacheRoot(extension.realRoot, cocRoot)
    for (const filename of Object.keys(require.cache)) {
      if (isInside(extension.realRoot, filename) || isInside(extension.root, filename)) {
        delete require.cache[filename]
      }
    }
  }
}

function validateCacheRoot(root: string, cocRoot: string): void {
  if (!path.isAbsolute(root)) {
    throw new Error(`Invalid extension root: ${root}`)
  }
  const normalized = path.normalize(root)
  if (path.parse(normalized).root === normalized) {
    throw new Error(`Refusing to clear module cache for filesystem root: ${root}`)
  }
  if (normalized === path.normalize(cocRoot) || isInside(normalized, cocRoot)) {
    throw new Error(`Refusing to clear module cache for coc.nvim root or its ancestor: ${root}`)
  }
}
