'use strict'
import { createLogger } from '../logger'
import { OutputChannel } from '../types'
import { pluginRoot } from '../util/constants'
import { isParentFolder } from '../util/fs'
import { fs, path } from '../util/node'
import { Disposable } from '../util/protocol'
import { ChangeCallback, createChangeFilter, FileChange, FileChangeItem, FileWatcherClient } from './fileWatcher'

const logger = createLogger('core-native-watcher')
const isGlob = require('is-glob') as (value: string) => boolean
const picomatch = require('picomatch') as {
  makeRe(pattern: string, options: { dot: boolean, windows: boolean }): RegExp
}

type NativeEventType = 'create' | 'update' | 'delete'
type NativeEntryKind = 'file' | 'directory'

interface NativeEvent {
  path: string
  type: NativeEventType
  kind: NativeEntryKind
  renameId?: string
}

interface NativeOptions {
  ignorePaths?: string[]
  ignoreGlobs?: string[]
}

interface NativeBinding {
  subscribe(root: string, callback: (error: Error | null, events: NativeEvent[]) => void, options: NativeOptions): Promise<void>
  unsubscribe(root: string, callback: (error: Error | null, events: NativeEvent[]) => void, options: NativeOptions): Promise<void>
}

export interface NativeWatcherTarget {
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
    return 'glibc'
  }
}

export function getNativeWatcherTarget(platform = process.platform, arch = process.arch, libc = platform === 'linux' ? linuxLibc() : undefined): NativeWatcherTarget | undefined {
  if ((platform === 'darwin' || platform === 'win32') && (arch === 'x64' || arch === 'arm64')) return { filename: `${platform}-${arch}.node` }
  if (platform === 'linux' && (arch === 'x64' || arch === 'arm64') && (libc === 'glibc' || libc === 'musl')) return { filename: `${platform}-${arch}-${libc}.node` }
  return undefined
}

export function normalizeWatcherPath(filepath: string, platform = process.platform): string {
  if (platform === 'win32') {
    if (filepath.toLowerCase().startsWith('\\\\?\\unc\\')) filepath = `\\\\${filepath.slice(8)}`
    else if (filepath.startsWith('\\\\?\\')) filepath = filepath.slice(4)
    return path.win32.normalize(filepath)
  }
  filepath = path.normalize(filepath)
  return platform === 'darwin' ? filepath.normalize('NFC') : filepath
}

export function relativeWatcherPath(root: string, filepath: string, platform = process.platform): string | undefined {
  let pathModule = platform === 'win32' ? path.win32 : path.posix
  let normalizedRoot = normalizeWatcherPath(root, platform)
  let normalizedPath = normalizeWatcherPath(filepath, platform)
  let normalizedName = pathModule.relative(normalizedRoot, normalizedPath)
  if (!normalizedName || normalizedName === '..' || normalizedName.startsWith(`..${pathModule.sep}`) || pathModule.isAbsolute(normalizedName)) return undefined
  return normalizedName.split(pathModule.sep).join('/')
}

export function createNativeOptions(root: string, logicalRoot: string, ignored: readonly string[]): NativeOptions {
  let options: NativeOptions = {}
  for (let value of ignored) {
    if (!value) continue
    if (isGlob(value)) {
      let regex = picomatch.makeRe(value, { dot: true, windows: process.platform === 'win32' })
      ;(options.ignoreGlobs ??= []).push(regex.source)
      continue
    }
    let logicalPath = path.resolve(logicalRoot, value)
    // ignoredFolders can contain the logical root or one of its parents. Those
    // decide whether a client is created; only descendants exclude a native subtree.
    let relative: string
    if (isParentFolder(logicalRoot, logicalPath)) {
      relative = path.relative(logicalRoot, logicalPath)
    } else if (isParentFolder(root, logicalPath)) {
      relative = path.relative(root, logicalPath)
    } else {
      continue
    }
    ;(options.ignorePaths ??= []).push(path.resolve(root, relative))
  }
  return options
}

export default class NativeWatcher implements FileWatcherClient {
  private readonly listeners: ((change: FileChange) => void)[] = []
  private readonly pendingEvents: NativeEvent[][] = []
  private binding: NativeBinding | undefined
  private watchRoot: string | undefined
  private options: NativeOptions | undefined
  private disposed = false
  private ready = false
  private drainHandle: NodeJS.Immediate | undefined
  private readonly callback: (error: Error | null, events: NativeEvent[]) => void
  public readonly subscription = `native-${crypto.randomUUID()}`

  private constructor(public readonly root: string, private readonly channel?: OutputChannel) {
    this.callback = (error, events) => {
      if (this.disposed) return
      if (error) {
        logger.error('Native watcher error', error)
        this.appendOutput(`Native watcher error: ${error}`, 'Error')
        return
      }
      if (!Array.isArray(events) || events.length === 0) return
      this.pendingEvents.push(events)
      if (this.ready) this.scheduleDrain()
    }
  }

  public static async createClient(root: string, channel?: OutputChannel, isCancelled: () => boolean = () => false, ignored: readonly string[] = []): Promise<NativeWatcher> {
    let target = getNativeWatcherTarget()
    if (!target) throw new Error(`No native watcher binary for ${process.platform}-${process.arch}`)
    let watcher = new NativeWatcher(path.resolve(root), channel)
    let filepath = path.join(pluginRoot, 'bin', 'watcher', target.filename)
    let subscribed = false
    watcher.appendOutput(`Native watcher binary: ${filepath}`)
    try {
      if (isCancelled()) throw new Error('Native watcher creation cancelled')
      watcher.watchRoot = await fs.promises.realpath(watcher.root)
      if (isCancelled()) throw new Error('Native watcher creation cancelled')
      watcher.options = createNativeOptions(watcher.watchRoot, watcher.root, ignored)
      watcher.binding = require(filepath) as NativeBinding
      await watcher.binding.subscribe(watcher.watchRoot, watcher.callback, watcher.options)
      subscribed = true
      if (isCancelled()) throw new Error('Native watcher creation cancelled')
      watcher.ready = true
      watcher.scheduleDrain()
      watcher.appendOutput(`Native watcher using ${filepath} for ${watcher.root}`)
      return watcher
    } catch (error) {
      watcher.disposed = true
      if (subscribed) await watcher.unsubscribe()
      throw error
    }
  }

  public subscribe(globPattern: string, callback: ChangeCallback): Disposable {
    let filterChanges = createChangeFilter(globPattern)
    let listener = (change: FileChange) => {
      let filtered = filterChanges(change)
      if (filtered) callback(filtered)
    }
    this.listeners.push(listener)
    return Disposable.create(() => {
      let index = this.listeners.indexOf(listener)
      if (index !== -1) this.listeners.splice(index, 1)
    })
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.listeners.length = 0
    this.pendingEvents.length = 0
    if (this.drainHandle) clearImmediate(this.drainHandle)
    this.drainHandle = undefined
    void this.unsubscribe().catch(error => {
      logger.error('Error unsubscribing Native watcher', error)
      this.appendOutput(`Error unsubscribing Native watcher: ${error}`, 'Error')
    })
  }

  private scheduleDrain(): void {
    if (this.drainHandle || this.pendingEvents.length === 0) return
    this.drainHandle = setImmediate(() => {
      this.drainHandle = undefined
      while (!this.disposed && this.pendingEvents.length) this.emit(this.pendingEvents.shift()!)
    })
  }

  private emit(events: NativeEvent[]): void {
    let files: FileChangeItem[] = []
    for (let event of events) {
      if (event.kind !== 'file') continue
      let name = relativeWatcherPath(this.watchRoot!, event.path)
      if (!name) continue
      files.push({ name, exists: event.type !== 'delete', new: event.type === 'create', type: 'f', renameId: event.renameId })
    }
    if (files.length === 0 || this.disposed) return
    let change: FileChange = { root: this.root, subscription: this.subscription, files }
    this.appendOutput(`file changes detected: ${JSON.stringify(change, null, 2)}`)
    for (let listener of this.listeners) listener(change)
  }

  private async unsubscribe(): Promise<void> {
    let binding = this.binding
    let root = this.watchRoot
    let options = this.options
    this.binding = undefined
    if (binding && root && options) await binding.unsubscribe(root, this.callback, options)
  }

  private appendOutput(message: string, type = 'Info'): void {
    this.channel?.appendLine(`[${type}  - ${new Date().toLocaleTimeString()}] ${message}`)
  }
}
