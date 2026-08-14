'use strict'
import { fs, path } from '../util/node'

/**
 * Description of an extension module for the native loader.
 *
 * `root` is the absolute logical extension root, `realRoot` its resolved
 * filesystem path when available. `entry` is the absolute entry filename that
 * native require() should load. `moduleType` stays `commonjs` during the first
 * migration and is ready for native ESM support later.
 */
export interface ExtensionModuleDescription {
  id: string
  root: string
  realRoot: string
  entry: string
  moduleType: 'commonjs' | 'module'
}

/**
 * Directory-boundary membership check. Unlike raw startsWith(), this rejects
 * prefix collisions such as `/extensions/foo` vs `/extensions/foobar`.
 *
 * The root directory itself is not considered "inside" itself; every caller
 * passes a module filename, which is always a file below the root.
 */
export function isInside(parent: string, filename: string): boolean {
  const relative = path.relative(parent, filename)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/**
 * Create a module description from a logical extension root and entry file.
 * The real root is resolved once at registration time so the ownership lookup
 * hot path never needs a filesystem call.
 */
export function createModuleDescription(
  id: string,
  root: string,
  entry: string,
  moduleType: ExtensionModuleDescription['moduleType'] = 'commonjs'
): ExtensionModuleDescription {
  const absoluteRoot = path.resolve(root)
  let realRoot = absoluteRoot
  if (fs.existsSync(absoluteRoot)) {
    try {
      realRoot = fs.realpathSync(absoluteRoot)
    } catch (e) {
      // Best effort, keep the logical root when realpath fails.
    }
  }
  return {
    id,
    root: path.normalize(absoluteRoot),
    realRoot: path.normalize(realRoot),
    entry: path.resolve(entry),
    moduleType
  }
}

/**
 * Maps a module filename to the extension that owns it.
 *
 * Registered roots are kept in an immutable snapshot sorted by root length
 * descending, so the deeper root wins when extension roots are nested.
 * Lookup compares the real path first, then falls back to the logical path;
 * Node resolves symlinks in module filenames by default, which covers local
 * development with symlinked extensions without making identity unpredictable.
 */
export class ExtensionPathIndex {
  private entries: readonly ExtensionModuleDescription[] = []

  public update(extensions: readonly ExtensionModuleDescription[]): void {
    this.entries = [...extensions].sort(compareByRootLength)
  }

  public add(extension: ExtensionModuleDescription): void {
    const entries = this.entries.filter(e => e.id !== extension.id)
    entries.push(extension)
    this.entries = entries.sort(compareByRootLength)
  }

  public remove(extensionId: string): void {
    this.entries = this.entries.filter(e => e.id !== extensionId)
  }

  public findByFile(filename: string): ExtensionModuleDescription | undefined {
    for (const entry of this.entries) {
      if (isInside(entry.realRoot, filename) || isInside(entry.root, filename)) {
        return entry
      }
    }
    return undefined
  }
}

function compareByRootLength(a: ExtensionModuleDescription, b: ExtensionModuleDescription): number {
  return b.root.length - a.root.length
}
