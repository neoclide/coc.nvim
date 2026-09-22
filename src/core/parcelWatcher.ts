'use strict'
import { createLogger } from '../logger'
import type { Dirent } from 'fs'
import { OutputChannel } from '../types'
import { fs, path } from '../util/node'
import { Disposable } from '../util/protocol'
import { pluginRoot } from '../util/constants'
import { isParentFolder } from '../util/fs'
import { ChangeCallback, createChangeFilter, FileChange, FileChangeItem, FileChangeKind, FileWatcherClient } from './fileWatcher'

const logger = createLogger('core-parcel-watcher')

type ParcelEventType = 'create' | 'update' | 'delete'
type ParcelBackend = 'fs-events' | 'inotify' | 'windows' | 'kqueue'

interface ParcelEvent {
  path: string
  type: ParcelEventType
}

interface ParcelOptions {
  backend: ParcelBackend
  ignorePaths?: string[]
  ignoreGlobs?: string[]
}

interface ParcelBinding {
  subscribe(root: string, callback: (error: Error | null, events: ParcelEvent[]) => void, options: ParcelOptions): Promise<void>
  unsubscribe(root: string, callback: (error: Error | null, events: ParcelEvent[]) => void, options: ParcelOptions): Promise<void>
}

interface IndexedEntry {
  name: string
  type: FileChangeKind
  size?: number
  mtime_ms?: number
}

interface NormalizedEvent {
  event: ParcelEvent
  name: string
  key: string
  previous?: IndexedEntry
  current?: IndexedEntry
}

const isGlob = require('is-glob') as (value: string) => boolean
const picomatch = require('picomatch') as {
  makeRe(pattern: string, options: { dot: boolean, windows: boolean }): RegExp
}

export function createParcelOptions(root: string, backend: ParcelBackend, ignored: readonly string[]): ParcelOptions {
  let options: ParcelOptions = { backend }
  for (let value of ignored) {
    if (!value) continue
    if (isGlob(value)) {
      let regex = picomatch.makeRe(value, { dot: true, windows: process.platform === 'win32' })
      if (options.ignoreGlobs) options.ignoreGlobs.push(regex.source)
      else options.ignoreGlobs = [regex.source]
    } else {
      let filepath = path.resolve(root, value)
      // ignoredFolders also contains roots that should never be watched (for
      // example "/"). Only descendant paths are native subtree exclusions.
      if (!isParentFolder(root, filepath)) continue
      if (options.ignorePaths) options.ignorePaths.push(filepath)
      else options.ignorePaths = [filepath]
    }
  }
  return options
}

export function normalizeWatcherPath(filepath: string, platform = process.platform): string {
  if (platform === 'win32') {
    if (filepath.toLowerCase().startsWith('\\\\?\\unc\\')) {
      filepath = `\\\\${filepath.slice(8)}`
    } else if (filepath.startsWith('\\\\?\\')) {
      filepath = filepath.slice(4)
    }
    return path.win32.normalize(filepath)
  }
  filepath = path.normalize(filepath)
  return platform === 'darwin' ? filepath.normalize('NFC') : filepath
}

export function watcherPathKey(filepath: string, platform = process.platform): string {
  filepath = normalizeWatcherPath(filepath, platform)
  return platform === 'darwin' || platform === 'win32' ? filepath.toLowerCase() : filepath
}

export function relativeWatcherPath(root: string, filepath: string, platform = process.platform): string | undefined {
  let pathModule = platform === 'win32' ? path.win32 : path.posix
  root = normalizeWatcherPath(root, platform)
  filepath = normalizeWatcherPath(filepath, platform)
  let name = pathModule.relative(root, filepath).split(pathModule.sep).join('/')
  return !name || name === '..' || name.startsWith('../') || pathModule.isAbsolute(name) ? undefined : name
}

function coalesceEvents(events: ParcelEvent[]): ParcelEvent[] {
  let result = new Map<string, ParcelEvent>()
  for (let event of events) {
    let key = watcherPathKey(event.path)
    let previous = result.get(key)
    if (!previous) {
      result.set(key, event)
    } else if (previous.type === 'create' && event.type === 'delete') {
      result.delete(key)
    } else if (previous.type === 'delete' && event.type === 'create') {
      result.set(key, { ...event, type: 'update' })
    } else if (previous.type === 'create' || event.type === 'create') {
      result.set(key, { ...event, type: 'create' })
    } else {
      result.set(key, event)
    }
  }
  return Array.from(result.values())
}

export interface ParcelWatcherTarget {
  backend: ParcelBackend
  filename: string
}

export function detectLinuxLibc(report: unknown): 'glibc' | 'musl' {
  if (typeof report !== 'object' || report == null) return 'glibc'
  let header = (report as { header?: NodeJS.Dict<unknown> }).header
  return typeof header?.glibcVersionRuntime === 'string' ? 'glibc' : 'musl'
}

function linuxLibc(): 'glibc' | 'musl' {
  try {
    return detectLinuxLibc(process.report?.getReport())
  } catch (_e) {
    // glibc is the common Linux runtime and the safest fallback when runtime
    // reporting is unavailable or disabled.
    return 'glibc'
  }
}

export function getParcelWatcherTarget(platform = process.platform, arch = process.arch, libc = platform === 'linux' ? linuxLibc() : undefined): ParcelWatcherTarget | undefined {
  if (platform === 'darwin' && (arch === 'x64' || arch === 'arm64')) {
    return { backend: 'fs-events', filename: `${platform}-${arch}.node` }
  }
  if (platform === 'win32' && (arch === 'x64' || arch === 'arm64')) {
    return { backend: 'windows', filename: `${platform}-${arch}.node` }
  }
  if (platform === 'freebsd' && arch === 'x64') {
    return { backend: 'kqueue', filename: `${platform}-${arch}.node` }
  }
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64' || arch === 'arm') && (libc === 'glibc' || libc === 'musl')) {
    return { backend: 'inotify', filename: `${platform}-${arch}-${libc}.node` }
  }
  return undefined
}

function loadBinding(filepath: string): ParcelBinding {
  // The native binding is pinned and distributed with coc.nvim. Keep the
  // binding's private API isolated in this adapter.
  return require(filepath) as ParcelBinding
}

export default class ParcelWatcher implements FileWatcherClient {
  private readonly listeners: ((change: FileChange) => void)[] = []
  private readonly entries = new Map<string, IndexedEntry>()
  private readonly pendingEvents: ParcelEvent[][] = []
  private eventBuffer: ParcelEvent[] = []
  private eventTimer: NodeJS.Timeout | undefined
  private processing = Promise.resolve()
  private binding: ParcelBinding | undefined
  private watchRoot: string
  private options: ParcelOptions
  private ignoreGlobs: RegExp[] = []
  private ready = false
  private disposed = false
  private callback: (error: Error | null, events: ParcelEvent[]) => void
  public readonly subscription = `parcel-${crypto.randomUUID()}`

  private constructor(
    public readonly root: string,
    private readonly target: ParcelWatcherTarget,
    private readonly channel?: OutputChannel
  ) {
    this.options = { backend: target.backend }
    this.callback = (error, events) => {
      if (this.disposed) return
      if (error) {
        logger.error('Parcel watcher error', error)
        this.appendOutput(`Parcel watcher error: ${error}`, 'Error')
        return
      }
      if (!Array.isArray(events) || events.length === 0) return
      if (!this.ready) {
        this.pendingEvents.push(events)
        return
      }
      this.queueEvents(events)
    }
  }

  public static async createClient(root: string, channel?: OutputChannel, isCancelled: () => boolean = () => false, ignored: readonly string[] = []): Promise<ParcelWatcher> {
    let target = getParcelWatcherTarget()
    if (!target) throw new Error(`No Parcel watcher binary for ${process.platform}-${process.arch}`)
    let filepath = path.join(pluginRoot, 'bin', 'watcher', target.filename)
    let watcher = new ParcelWatcher(path.resolve(root), target, channel)
    try {
      watcher.binding = loadBinding(filepath)
      watcher.watchRoot = normalizeWatcherPath(await fs.promises.realpath(watcher.root).catch(() => watcher.root))
      watcher.options = createParcelOptions(watcher.watchRoot, target.backend, ignored)
      watcher.ignoreGlobs = (watcher.options.ignoreGlobs ?? []).map(source => new RegExp(source))
      await watcher.binding.subscribe(watcher.watchRoot, watcher.callback, watcher.options)
      let entries = await watcher.scanDirectory('', isCancelled)
      if (watcher.disposed || isCancelled()) throw new Error('Parcel watcher creation cancelled')
      for (let entry of entries) watcher.setEntry(entry)
      watcher.ready = true
      for (let events of watcher.pendingEvents.splice(0)) watcher.queueEvents(events)
      watcher.appendOutput(`Parcel watcher using ${target.backend} for ${watcher.root}`)
      return watcher
    } catch (error) {
      watcher.dispose()
      throw error
    }
  }

  public subscribe(globPattern: string, callback: ChangeCallback): Disposable {
    let filterChanges = createChangeFilter(globPattern)
    let fn = (change: FileChange) => {
      let filtered = filterChanges(change)
      if (filtered) callback(filtered)
    }
    this.listeners.push(fn)
    return Disposable.create(() => {
      let idx = this.listeners.indexOf(fn)
      if (idx !== -1) this.listeners.splice(idx, 1)
    })
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.listeners.length = 0
    this.entries.clear()
    this.pendingEvents.length = 0
    this.eventBuffer.length = 0
    if (this.eventTimer) clearTimeout(this.eventTimer)
    this.eventTimer = undefined
    let binding = this.binding
    this.binding = undefined
    if (binding && this.watchRoot) {
      void binding.unsubscribe(this.watchRoot, this.callback, this.options).catch(error => {
        logger.error('Error unsubscribing Parcel watcher', error)
      })
    }
  }

  private async processEvents(events: ParcelEvent[]): Promise<void> {
    if (this.disposed) return
    let normalized = (await Promise.all(events.map(event => this.normalizeEvent(event)))).filter((event): event is NormalizedEvent => event != null)
    let deletedDirectories = normalized.filter(item => item.event.type === 'delete' && item.previous?.type === 'd')
    let createdDirectories = normalized.filter(item => item.event.type === 'create' && item.current?.type === 'd')
    normalized = normalized.filter(item => {
      let parents = item.event.type === 'delete' ? deletedDirectories : item.event.type === 'create' ? createdDirectories : []
      return !parents.some(parent => parent !== item && item.key.startsWith(`${parent.key}/`))
    })
    let changes = new Map<string, FileChangeItem>()
    let addChange = (file: FileChangeItem): void => {
      changes.set(`${file.exists ? '1' : '0'}:${this.entryKey(file.name)}`, file)
    }
    for (let item of normalized) {
      if (this.disposed) return
      if (item.event.type === 'delete') {
        if (item.previous?.type === 'd') {
          for (let entry of this.entriesBelow(item.key)) {
            if (entry.type === 'f') addChange(this.fileChange(entry, false, false))
          }
          this.removeEntries(item.key)
        } else {
          let entry = item.previous ?? { name: item.name, type: 'f' as const }
          if (entry.type === 'f') addChange(this.fileChange(entry, false, false))
          this.entries.delete(item.key)
        }
        continue
      }
      let entry = item.current
      if (!entry) continue
      if (entry.type === 'd') {
        this.setEntry(entry)
        if (item.event.type === 'create') {
          let children = await this.scanDirectory(entry.name, () => this.disposed)
          if (this.disposed) return
          for (let child of children) {
            this.setEntry(child)
            if (child.type === 'f') addChange(this.fileChange(child, true, true))
          }
        }
      } else {
        this.setEntry(entry)
        if (entry.type === 'f') addChange(this.fileChange(entry, true, item.event.type === 'create' && item.previous?.type !== 'f'))
      }
    }
    let files = Array.from(changes.values())
    if (files.length === 0) return
    let change: FileChange = { root: this.root, subscription: this.subscription, files }
    this.appendOutput(`file changes detected: ${JSON.stringify(change, null, 2)}`)
    for (let listener of this.listeners) listener(change)
  }

  private queueEvents(events: ParcelEvent[]): void {
    this.eventBuffer.push(...events)
    if (this.eventTimer) return
    this.eventTimer = setTimeout(() => {
      this.eventTimer = undefined
      if (this.disposed) return
      let buffered = coalesceEvents(this.eventBuffer.splice(0))
      if (buffered.length === 0) return
      this.processing = this.processing.then(() => this.processEvents(buffered)).catch(error => {
        logger.error('Error processing Parcel watcher events', error)
        this.appendOutput(`Error processing Parcel watcher events: ${error}`, 'Error')
      })
    }, 75)
  }

  private async normalizeEvent(event: ParcelEvent): Promise<NormalizedEvent | undefined> {
    let name = this.relativeEventPath(event.path)
    if (!name || this.isIgnored(name)) return undefined
    let key = this.entryKey(name)
    let previous = this.entries.get(key)
    let current = event.type === 'delete' ? undefined : await this.readEntry(name)
    return { event, name, key, previous, current }
  }

  private relativeEventPath(filepath: string): string | undefined {
    return relativeWatcherPath(this.watchRoot, filepath)
  }

  private entryKey(name: string): string {
    if (process.platform === 'darwin') name = name.normalize('NFC')
    return process.platform === 'darwin' || process.platform === 'win32' ? name.toLowerCase() : name
  }

  private physicalPath(name: string): string {
    return path.join(this.watchRoot, ...name.split('/'))
  }

  private isIgnored(name: string): boolean {
    let filepath = this.physicalPath(name)
    if (this.options.ignorePaths?.some(ignored => isParentFolder(ignored, filepath, true))) return true
    return this.ignoreGlobs.some(regex => regex.test(name))
  }

  private async readEntry(name: string): Promise<IndexedEntry | undefined> {
    try {
      let filepath = this.physicalPath(name)
      let stat = await fs.promises.lstat(filepath)
      if (stat.isSymbolicLink()) {
        try {
          let target = await fs.promises.stat(filepath)
          if (target.isFile()) return { name, type: 'f', size: target.size, mtime_ms: target.mtimeMs }
        } catch (_e) {
          // Keep dangling links indexed as non-file entries.
        }
        return { name, type: 'o' }
      }
      let type: FileChangeKind = stat.isFile() ? 'f' : stat.isDirectory() ? 'd' : 'o'
      return { name, type, size: type === 'f' ? stat.size : undefined, mtime_ms: type === 'f' ? stat.mtimeMs : undefined }
    } catch (_e) {
      return undefined
    }
  }

  private async scanDirectory(root: string, isCancelled: () => boolean): Promise<IndexedEntry[]> {
    let pending = [root]
    let result: IndexedEntry[] = []
    while (pending.length && !this.disposed && !isCancelled()) {
      let folder = pending.pop()
      let entries: Dirent[]
      try {
        entries = await fs.promises.readdir(this.physicalPath(folder), { withFileTypes: true })
      } catch (_e) {
        continue
      }
      for (let dirent of entries) {
        let name = folder ? `${folder}/${dirent.name}` : dirent.name
        if (this.isIgnored(name)) continue
        if (dirent.isDirectory()) {
          result.push({ name, type: 'd' })
          pending.push(name)
        } else if (dirent.isFile() || dirent.isSymbolicLink()) {
          let entry = await this.readEntry(name)
          if (entry) result.push(entry)
        } else {
          result.push({ name, type: 'o' })
        }
      }
    }
    return result
  }

  private setEntry(entry: IndexedEntry): void {
    this.entries.set(this.entryKey(entry.name), entry)
  }

  private entriesBelow(key: string): IndexedEntry[] {
    let prefix = `${key}/`
    return Array.from(this.entries.entries()).filter(([candidate]) => candidate.startsWith(prefix)).map(([, entry]) => entry)
  }

  private removeEntries(key: string): void {
    let prefix = `${key}/`
    for (let candidate of this.entries.keys()) {
      if (candidate === key || candidate.startsWith(prefix)) this.entries.delete(candidate)
    }
  }

  private fileChange(entry: IndexedEntry, exists: boolean, isNew: boolean): FileChangeItem {
    return { name: entry.name, exists, new: isNew, type: 'f', size: entry.size, mtime_ms: entry.mtime_ms }
  }

  private appendOutput(message: string, type = 'Info'): void {
    this.channel?.appendLine(`[${type}  - ${new Date().toLocaleTimeString()}] ${message}`)
  }
}
