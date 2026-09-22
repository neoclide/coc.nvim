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
  subscribe(globPattern: string, callback: ChangeCallback): Disposable
}

/** Compile a backend-root glob once and apply it to normalized file events. */
export function createChangeFilter(globPattern: string): (change: FileChange) => FileChange | undefined {
  let matcher = new Minimatch(globPattern, { dot: true })
  return change => {
    let files = change.files.filter(file => file.type === 'f' && matcher.match(file.name))
    return files.length === 0 ? undefined : { ...change, files }
  }
}
