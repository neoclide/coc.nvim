'use strict'
import { Disposable } from '../util/protocol'
import { Minimatch } from 'minimatch'

export type FileChangeKind = 'f' | 'd' | 'o'

export interface FileChangeItem {
  size?: number
  name: string
  exists: boolean
  new: boolean
  type: FileChangeKind
  mtime_ms?: number
  renameId?: string
}

export interface FileChange {
  root: string
  subscription?: string
  files: FileChangeItem[]
}

export type ChangeCallback = (change: FileChange) => void

/**
 * Common interface implemented by filesystem watch backends.
 */
export interface FileWatcherClient extends Disposable {
  readonly root: string
  readonly subscription: string | undefined
  readonly supportsRenameId: boolean
  subscribe(globPattern: string, callback: ChangeCallback, includeDirectories?: boolean): Disposable
}

/** Compile a backend-root glob once and apply it to normalized entry events. */
export function createChangeFilter(globPattern: string, includeDirectories = false): (change: FileChange) => FileChange | undefined {
  let matcher = new Minimatch(globPattern, { dot: true })
  return change => {
    let files = change.files.filter(file => (file.type === 'f' || includeDirectories && file.type === 'd') && matcher.match(file.name))
    return files.length === 0 ? undefined : { ...change, files }
  }
}
