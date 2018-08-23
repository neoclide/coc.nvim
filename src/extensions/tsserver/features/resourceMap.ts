/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Maps of file resources
 *
 * Attempts to handle correct mapping on both case sensitive and case in-sensitive
 * file systems.
 */
export class ResourceMap<T> {
  private readonly _map = new Map<string, T>()

  constructor(
    private readonly _normalizePath?: (resource: string) => string | null
  ) { }

  public has(resource: string): boolean {
    const file = this.toKey(resource)
    return !!file && this._map.has(file)
  }

  public get(resource: string): T | undefined {
    const file = this.toKey(resource)
    return file ? this._map.get(file) : undefined
  }

  public set(resource: string, value: T): void {
    const file = this.toKey(resource)
    if (file) {
      this._map.set(file, value)
    }
  }

  public delete(resource: string): void {
    const file = this.toKey(resource)
    if (file) {
      this._map.delete(file)
    }
  }

  public get values(): Iterable<T> {
    return this._map.values()
  }

  public get keys(): Iterable<string> {
    return this._map.keys()
  }

  private toKey(resource: string): string | null {
    const key = this._normalizePath
      ? this._normalizePath(resource)
      : resource
    if (!key) {
      return key
    }
    return this.isCaseInsensitivePath(key) ? key.toLowerCase() : key
  }

  private isCaseInsensitivePath(path: string): boolean {
    if (isWindowsPath(path)) {
      return true
    }
    return path[0] === '/' && this.onIsCaseInsenitiveFileSystem
  }

  private get onIsCaseInsenitiveFileSystem(): boolean {
    if (process.platform === 'win32') {
      return true
    }
    if (process.platform === 'darwin') {
      return true
    }
    return false
  }
}

export function isWindowsPath(path: string): boolean {
  return /^[a-zA-Z]:\\/.test(path)
}
