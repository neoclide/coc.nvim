'use strict'
import { WorkspaceFolder } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { createLogger } from '../logger'
import { GlobPattern, IFileSystemWatcher, OutputChannel } from '../types'
import { disposeAll } from '../util'
import { splitArray } from '../util/array'
import { isParentFolder, sameFile } from '../util/fs'
import { minimatch, path, which } from '../util/node'
import { Disposable, Emitter, Event } from '../util/protocol'
import Watchman, { FileChange } from './watchman'
import type WorkspaceFolderControl from './workspaceFolder'
const logger = createLogger('fileSystemWatcher')

export interface RenameEvent {
  oldUri: URI
  newUri: URI
}

export class FileSystemWatcherManager {
  private clientsMap: Map<string, Watchman | null> = new Map()
  private disposables: Disposable[] = []
  private channel: OutputChannel | undefined
  private creating: Set<string> = new Set()
  public static watchers: Set<FileSystemWatcher> = new Set()
  private readonly _onDidCreateClient = new Emitter<string>()
  private disabled = global.__TEST__
  public readonly onDidCreateClient: Event<string> = this._onDidCreateClient.event
  constructor(
    private workspaceFolder: WorkspaceFolderControl,
    private watchmanPath: string | null
  ) {
  }

  public attach(channel: OutputChannel): void {
    this.channel = channel
    let createClient = (folder: WorkspaceFolder) => {
      let root = URI.parse(folder.uri).fsPath
      void this.createClient(root)
    }
    this.workspaceFolder.workspaceFolders.forEach(folder => {
      createClient(folder)
    })
    this.workspaceFolder.onDidChangeWorkspaceFolders(e => {
      e.added.forEach(folder => {
        createClient(folder)
      })
      e.removed.forEach(folder => {
        let root = URI.parse(folder.uri).fsPath
        let client = this.clientsMap.get(root)
        if (client) {
          this.clientsMap.delete(root)
          client.dispose()
        }
      })
    }, null, this.disposables)
  }

  public waitClient(root: string): Promise<void> {
    if (this.clientsMap.has(root)) return Promise.resolve()
    return new Promise(resolve => {
      let disposable = this.onDidCreateClient(r => {
        if (r == root) {
          disposable.dispose()
          resolve()
        }
      })
    })
  }

  public async createClient(root: string): Promise<void> {
    if (this.watchmanPath == null || this.has(root) || this.disabled) return
    try {
      let watchmanPath = await this.getWatchmanPath()
      this.creating.add(root)
      let client = await Watchman.createClient(watchmanPath, root, this.channel)
      this.creating.delete(root)
      this.clientsMap.set(root, client)
      for (let watcher of FileSystemWatcherManager.watchers) {
        watcher.listen(root, client)
      }
      this._onDidCreateClient.fire(root)
    } catch (e) {
      this.creating.delete(root)
      if (this.channel) this.channel.appendLine(`Error on create watchman client: ${e}`)
    }
  }

  public async getWatchmanPath(): Promise<string> {
    let watchmanPath = this.watchmanPath
    if (!process.env.WATCHMAN_SOCK) {
      watchmanPath = await which(this.watchmanPath, { all: false })
    }
    return watchmanPath
  }

  private has(root: string): boolean {
    let curr = Array.from(this.clientsMap.keys())
    curr.push(...this.creating)
    return curr.some(r => sameFile(r, root))
  }

  public createFileSystemWatcher(
    globPattern: GlobPattern,
    ignoreCreateEvents: boolean,
    ignoreChangeEvents: boolean,
    ignoreDeleteEvents: boolean): FileSystemWatcher {
    let fileWatcher = new FileSystemWatcher(globPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents)
    let base = typeof globPattern === 'string' ? undefined : globPattern.baseUri.fsPath
    for (let [root, client] of this.clientsMap.entries()) {
      if (base && isParentFolder(root, base, true)) {
        base = undefined
      }
      fileWatcher.listen(root, client)
    }
    if (base) void this.createClient(base)
    FileSystemWatcherManager.watchers.add(fileWatcher)
    return fileWatcher
  }

  public dispose(): void {
    this._onDidCreateClient.dispose()
    for (let client of this.clientsMap.values()) {
      if (client) client.dispose()
    }
    this.clientsMap.clear()
    FileSystemWatcherManager.watchers.clear()
    disposeAll(this.disposables)
  }
}

/*
 * FileSystemWatcher for watch workspace folders.
 */
export class FileSystemWatcher implements IFileSystemWatcher {
  private _onDidCreate = new Emitter<URI>()
  private _onDidChange = new Emitter<URI>()
  private _onDidDelete = new Emitter<URI>()
  private _onDidRename = new Emitter<RenameEvent>()
  private disposables: Disposable[] = []
  private _disposed = false
  public subscribe: string
  public readonly onDidCreate: Event<URI> = this._onDidCreate.event
  public readonly onDidChange: Event<URI> = this._onDidChange.event
  public readonly onDidDelete: Event<URI> = this._onDidDelete.event
  public readonly onDidRename: Event<RenameEvent> = this._onDidRename.event
  private readonly _onDidListen = new Emitter<void>()
  public readonly onDidListen: Event<void> = this._onDidListen.event

  constructor(
    private globPattern: GlobPattern,
    public ignoreCreateEvents: boolean,
    public ignoreChangeEvents: boolean,
    public ignoreDeleteEvents: boolean,
  ) {
  }

  public listen(root: string, client: Watchman): void {
    let { globPattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents } = this
    let pattern: string
    let basePath: string | undefined
    if (typeof globPattern === 'string') {
      pattern = globPattern
    } else {
      pattern = globPattern.pattern
      basePath = globPattern.baseUri.fsPath
      // ignore client
      if (!isParentFolder(root, basePath, true)) return
    }
    const onChange = (change: FileChange) => {
      let { root, files } = change
      if (basePath && !sameFile(root, basePath)) {
        files = files.filter(f => {
          if (f.type != 'f') return false
          let fullpath = path.join(root, f.name)
          if (!isParentFolder(basePath, fullpath)) return false
          return minimatch(path.relative(basePath, fullpath), pattern, { dot: true })
        })
      } else {
        files = files.filter(f => f.type == 'f' && minimatch(f.name, pattern, { dot: true }))
      }
      for (let file of files) {
        let uri = URI.file(path.join(root, file.name))
        if (!file.exists) {
          if (!ignoreDeleteEvents) this._onDidDelete.fire(uri)
        } else {
          if (file.new === true) {
            if (!ignoreCreateEvents) this._onDidCreate.fire(uri)
          } else {
            if (!ignoreChangeEvents) this._onDidChange.fire(uri)
          }
        }
      }
      // file rename
      if (files.length == 2 && files[0].exists !== files[1].exists) {
        let oldFile = files.find(o => o.exists !== true)
        let newFile = files.find(o => o.exists === true)
        if (oldFile.size == newFile.size) {
          this._onDidRename.fire({
            oldUri: URI.file(path.join(root, oldFile.name)),
            newUri: URI.file(path.join(root, newFile.name))
          })
        }
      }
      // detect folder rename
      if (files.length > 2 && files.length % 2 == 0) {
        let [oldFiles, newFiles] = splitArray(files, o => o.exists === false)
        if (oldFiles.length == newFiles.length) {
          for (let oldFile of oldFiles) {
            let newFile = newFiles.find(o => o.size == oldFile.size && o.mtime_ms == oldFile.mtime_ms)
            if (newFile) {
              this._onDidRename.fire({
                oldUri: URI.file(path.join(root, oldFile.name)),
                newUri: URI.file(path.join(root, newFile.name))
              })
            }
          }
        }
      }
    }
    client.subscribe(pattern, onChange).then(disposable => {
      if (!disposable) return
      this._onDidListen.fire()
      this.subscribe = disposable.subscribe
      if (this._disposed) return disposable.dispose()
      this.disposables.push(disposable)
    }, e => {
      if (e instanceof Error && e.message.includes('client was ended')) return
      logger.error(`Error on subscribe ${pattern}`, e)
    })
  }

  public dispose(): void {
    this._disposed = true
    FileSystemWatcherManager.watchers.delete(this)
    this._onDidRename.dispose()
    this._onDidCreate.dispose()
    this._onDidChange.dispose()
    disposeAll(this.disposables)
  }
}
