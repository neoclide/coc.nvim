'use strict'
import { WorkspaceFolder } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { createLogger } from '../logger'
import { FileSystemWatcherOptions, FileWatchConfig, GlobPattern, IFileSystemWatcher, OutputChannel } from '../types'
import { disposeAll, isTester } from '../util'
import { splitArray } from '../util/array'
import { isCancellationError } from '../util/errors'
import { isFolderIgnored, isParentFolder, normalizeFilePath, sameFile } from '../util/fs'
import { minimatch, path, which } from '../util/node'
import { CancellationToken, CancellationTokenSource, Disposable, Emitter, Event } from '../util/protocol'
import { FileChange, FileWatcherClient } from './fileWatcher'
import NativeWatcher, { createGitNativeOptions } from './nativeWatcher'
import Watchman from './watchman'
import type WorkspaceFolderControl from './workspaceFolder'
const logger = createLogger('fileSystemWatcher')
const WATCHMAN_COMMAND = 'watchman'

export interface RenameEvent {
  oldUri: URI
  newUri: URI
}

interface GitWatcherClient {
  client?: NativeWatcher
  creating?: Promise<void>
  watchers: Set<FileSystemWatcher>
  token: CancellationToken
}

export class FileSystemWatcherManager {
  private clientsMap: Map<string, FileWatcherClient> = new Map()
  private disposables: Disposable[] = []
  private channel: OutputChannel | undefined
  private creating: Map<string, Promise<FileWatcherClient | false | undefined>> = new Map()
  private tokenSourcesMap: Map<string, CancellationTokenSource> = new Map()
  private gitClients = new Map<string, GitWatcherClient>()
  private disposed = false
  public static watchers: Set<FileSystemWatcher> = new Set()
  private readonly _onDidCreateClient = new Emitter<string>()
  public disabled: boolean
  public readonly onDidCreateClient: Event<string> = this._onDidCreateClient.event
  constructor(
    private workspaceFolder: WorkspaceFolderControl,
    private config: FileWatchConfig
  ) {
    this.disabled = config.enable === false || global.__TEST__ || isTester
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
        let root = normalizeFilePath(URI.parse(folder.uri).fsPath)
        // Invalidate any in-flight creation for this root so its client is
        // disposed before it can be published or subscribed.
        this.creating.delete(root)
        let tokenSource = this.tokenSourcesMap.get(root)
        if (tokenSource) {
          this.tokenSourcesMap.delete(root)
          tokenSource.cancel()
          tokenSource.dispose()
        }
        let client = this.clientsMap.get(root)
        if (client) {
          this.clientsMap.delete(root)
          client.dispose()
        }
      })
    }, null, this.disposables)
  }

  public waitClient(root: string): Promise<FileWatcherClient | false | undefined> {
    root = normalizeFilePath(root)
    if (this.clientsMap.has(root)) return Promise.resolve(this.clientsMap.get(root))
    let pending = this.creating.get(root)
    if (pending) return pending
    return new Promise(resolve => {
      let disposable = this.onDidCreateClient(r => {
        if (r == root) {
          disposable.dispose()
          resolve(this.clientsMap.get(r))
        }
      })
    })
  }

  public async createClient(root: string, skipCheck = false): Promise<FileWatcherClient | false | undefined> {
    root = normalizeFilePath(root)
    if (this.disposed) return false
    if (!skipCheck && (this.disabled || isFolderIgnored(root, this.config.ignoredFolders))) return
    if (this.has(root)) return this.waitClient(root)
    let pending = this.creating.get(root)
    if (pending) return pending
    let p = this.createClientInner(root)
    this.creating.set(root, p)
    return p.finally(() => {
      if (this.creating.get(root) === p) this.creating.delete(root)
    })
  }

  private async createClientInner(root: string): Promise<FileWatcherClient | false | undefined> {
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    this.tokenSourcesMap.set(root, tokenSource)
    try {
      let client: FileWatcherClient | undefined
      let backends = this.config.watchmanPath ? ['watchman', 'native'] : ['native', 'watchman']
      for (let backend of backends) {
        if (token.isCancellationRequested) return false
        try {
          this.channel?.appendLine(`Trying ${backend} watcher for ${root}`)
          if (backend === 'native') {
            client = await NativeWatcher.createClient(root, this.channel, token, this.config.ignoredFolders)
          } else {
            let watchmanPath = await this.getWatchmanPath()
            this.channel?.appendLine(`Watchman executable: ${watchmanPath}`)
            if (token.isCancellationRequested) return false
            client = await Watchman.createClient(watchmanPath, root, this.channel)
          }
          this.channel?.appendLine(`Using ${backend} watcher for ${root}`)
          break
        } catch (error) {
          this.channel?.appendLine(`Unable to use ${backend} watcher for ${root}: ${error}`)
        }
      }
      // The folder was removed or the manager disposed while the client was
      // being created: the client must be closed, never published.
      if (token.isCancellationRequested) {
        client?.dispose()
        return false
      }
      if (!client) {
        this.channel?.appendLine(`No file watcher backend available for ${root}`)
        return false
      }
      this.clientsMap.set(root, client)
      for (let watcher of FileSystemWatcherManager.watchers) {
        watcher.listen(root, client)
      }
      this._onDidCreateClient.fire(root)
      return client
    } catch (e) {
      if (this.channel) this.channel.appendLine(`Error on create file watcher client: ${e}`)
      return false
    } finally {
      if (this.tokenSourcesMap.get(root) === tokenSource) this.tokenSourcesMap.delete(root)
      tokenSource.dispose()
    }
  }

  public async getWatchmanPath(): Promise<string> {
    let watchmanPath = this.config.watchmanPath || WATCHMAN_COMMAND
    if (!process.env.WATCHMAN_SOCK) {
      watchmanPath = await which(watchmanPath, { all: false })
    }
    return watchmanPath
  }

  private has(root: string): boolean {
    let curr = Array.from(this.clientsMap.keys())
    curr.push(...this.creating.keys())
    return curr.some(r => sameFile(r, root))
  }

  public createFileSystemWatcher(globPattern: GlobPattern, options: FileSystemWatcherOptions | boolean = false, ignoreChangeEvents = false, ignoreDeleteEvents = false): FileSystemWatcher {
    let opts: FileSystemWatcherOptions = typeof options === 'boolean' ? { ignoreCreateEvents: options, ignoreChangeEvents, ignoreDeleteEvents } : options
    let fileWatcher = new FileSystemWatcher(globPattern, opts.ignoreCreateEvents ?? false, opts.ignoreChangeEvents ?? false, opts.ignoreDeleteEvents ?? false, opts.includeDirectories ?? false)
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

  /** Share a restricted native watcher for an absolute Git metadata directory. */
  public createGitFileSystemWatcher(gitDir: string): FileSystemWatcher {
    if (!path.isAbsolute(gitDir)) throw new Error(`Git metadata directory must be absolute: ${gitDir}`)
    let root = normalizeFilePath(path.resolve(gitDir))
    let watcher = new FileSystemWatcher('{HEAD,index,packed-refs,config,shallow,refs/**}', false, false, false, false)
    if (this.disposed || this.disabled) return watcher
    let gitClient = this.gitClients.get(root)
    if (!gitClient) {
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      gitClient = { watchers: new Set([watcher]), token }
      this.gitClients.set(root, gitClient)
      this.tokenSourcesMap.set('git:' + root, tokenSource)
      let creating = NativeWatcher.createClient(root, this.channel, token, [], createGitNativeOptions())
        .then(client => {
          if (token.isCancellationRequested) {
            client.dispose()
            return
          }
          gitClient.client = client
          for (let item of gitClient.watchers) {
            item.listen(root, client)
          }
        })
        .catch(error => {
          if (this.gitClients.get(root) === gitClient) this.gitClients.delete(root)
          if (this.tokenSourcesMap.get('git:' + root) === tokenSource) this.tokenSourcesMap.delete('git:' + root)
          tokenSource.dispose()
          if (!isCancellationError(error)) {
            this.channel?.appendLine(`Unable to use native Git metadata watcher for ${root}: ${error}`)
          }
        })
        .finally(() => {
          gitClient.creating = undefined
        })
      gitClient.creating = creating
    } else {
      gitClient.watchers.add(watcher)
      if (gitClient.client) {
        watcher.listen(root, gitClient.client)
      }
    }
    watcher.onDidDispose(() => {
      gitClient.watchers.delete(watcher)
      if (gitClient.watchers.size !== 0 || this.gitClients.get(root) !== gitClient) return
      this.gitClients.delete(root)
      let tokenSource = this.tokenSourcesMap.get('git:' + root)
      if (tokenSource) {
        this.tokenSourcesMap.delete('git:' + root)
        tokenSource.cancel()
        tokenSource.dispose()
      }
      gitClient.client?.dispose()
    })
    return watcher
  }

  public dispose(): void {
    this.disposed = true
    this._onDidCreateClient.dispose()
    for (let tokenSource of this.tokenSourcesMap.values()) {
      tokenSource.cancel()
      tokenSource.dispose()
    }
    this.tokenSourcesMap.clear()
    for (let client of this.clientsMap.values()) {
      if (client) client.dispose()
    }
    this.clientsMap.clear()
    for (let entry of this.gitClients.values()) {
      entry.client?.dispose()
    }
    this.gitClients.clear()
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
  public subscribe: string
  public readonly onDidCreate: Event<URI> = this._onDidCreate.event
  public readonly onDidChange: Event<URI> = this._onDidChange.event
  public readonly onDidDelete: Event<URI> = this._onDidDelete.event
  public readonly onDidRename: Event<RenameEvent> = this._onDidRename.event
  private readonly _onDidListen = new Emitter<void>()
  public readonly onDidListen: Event<void> = this._onDidListen.event
  private readonly _onDidDispose = new Emitter<void>()
  public readonly onDidDispose: Event<void> = this._onDidDispose.event
  private disposed = false

  constructor(
    private globPattern: GlobPattern,
    public ignoreCreateEvents: boolean,
    public ignoreChangeEvents: boolean,
    public ignoreDeleteEvents: boolean,
    private includeDirectories = false
  ) {
  }

  public listen(root: string, client: FileWatcherClient): void {
    if (this.disposed) return
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
      let { root } = change
      let renames = new Set<string>()
      let fireRename = (oldPath: string, newPath: string): void => {
        let key = `${oldPath}\0${newPath}`
        if (renames.has(key)) return
        renames.add(key)
        this._onDidRename.fire({ oldUri: URI.file(oldPath), newUri: URI.file(newPath) })
      }
      let matches = (name: string): boolean => {
        // The backend subscription already applied string patterns. Relative
        // patterns still need their base path checked here.
        if (!basePath) return true
        let fullpath = path.join(root, name)
        if (!sameFile(root, basePath)) {
          if (!isParentFolder(basePath, fullpath)) return false
          return minimatch(path.relative(basePath, fullpath), pattern, { dot: true })
        }
        return minimatch(name, pattern, { dot: true })
      }
      let files = change.files.filter(file => (file.type === 'f' || this.includeDirectories && file.type === 'd') && matches(file.name))
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
      if (client.supportsRenameId) {
        let renamePairs = new Map<string, { oldFile?: typeof files[number], newFile?: typeof files[number] }>()
        for (let file of files) {
          if (!file.renameId) continue
          let pair = renamePairs.get(file.renameId) ?? {}
          if (file.exists) pair.newFile = file
          else pair.oldFile = file
          renamePairs.set(file.renameId, pair)
        }
        for (let pair of renamePairs.values()) {
          if (pair.oldFile && pair.newFile) {
            fireRename(path.join(root, pair.oldFile.name), path.join(root, pair.newFile.name))
          }
        }
        return
      }
      // file rename
      if (files.length == 2 && files[0].exists !== files[1].exists) {
        let oldFile = files.find(o => o.exists !== true)
        let newFile = files.find(o => o.exists === true)
        if (oldFile.size != null
          && newFile.size != null
          && oldFile.mtime_ms != null
          && newFile.mtime_ms != null
          && oldFile.size == newFile.size
          && oldFile.mtime_ms == newFile.mtime_ms) {
          fireRename(path.join(root, oldFile.name), path.join(root, newFile.name))
        }
      }
      // detect folder rename
      if (files.length > 2 && files.length % 2 == 0) {
        let [oldFiles, newFiles] = splitArray(files, o => o.exists === false)
        if (oldFiles.length == newFiles.length) {
          let candidates = new Map<string, typeof newFiles>()
          for (let newFile of newFiles) {
            if (newFile.size == null || newFile.mtime_ms == null) continue
            let key = `${newFile.size}\0${newFile.mtime_ms}`
            let items = candidates.get(key)
            if (items) items.push(newFile)
            else candidates.set(key, [newFile])
          }
          for (let oldFile of oldFiles) {
            if (oldFile.size == null || oldFile.mtime_ms == null) continue
            let newFile = candidates.get(`${oldFile.size}\0${oldFile.mtime_ms}`)?.shift()
            if (newFile) {
              fireRename(path.join(root, oldFile.name), path.join(root, newFile.name))
            }
          }
        }
      }
    }
    this.subscribe = client.subscription
    // Relative patterns are matched against basePath in onChange. The client
    // filters names relative to its own root, so the bare pattern would drop
    // changes below a nested base before onChange receives them.
    let disposable = client.subscribe(basePath ? '**/*' : pattern, onChange, this.includeDirectories)
    this.disposables.push(disposable)
    this._onDidListen.fire()
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this._onDidDispose.fire()
    FileSystemWatcherManager.watchers.delete(this)
    this._onDidRename.dispose()
    this._onDidCreate.dispose()
    this._onDidChange.dispose()
    this._onDidDelete.dispose()
    this._onDidListen.dispose()
    disposeAll(this.disposables)
  }
}
