import minimatch from 'minimatch'
import path from 'path'
import fs from 'fs'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { OutputChannel } from '../types'
import { disposeAll } from '../util'
import { splitArray } from '../util/array'
import Watchman, { FileChange } from './watchman'
import WorkspaceFolder from './workspaceFolder'
const logger = require('../util/logger')('filesystem-watcher')

export interface RenameEvent {
  oldUri: URI
  newUri: URI
}

/*
 * FileSystemWatcher for watch workspace folders.
 */
export default class FileSystemWatcher implements Disposable {
  private _onDidCreate = new Emitter<URI>()
  private _onDidChange = new Emitter<URI>()
  private _onDidDelete = new Emitter<URI>()
  private _onDidRename = new Emitter<RenameEvent>()
  private _watchedFolders: Set<string> = new Set()

  private _disposed = false
  public subscribe: string
  public readonly onDidCreate: Event<URI> = this._onDidCreate.event
  public readonly onDidChange: Event<URI> = this._onDidChange.event
  public readonly onDidDelete: Event<URI> = this._onDidDelete.event
  public readonly onDidRename: Event<RenameEvent> = this._onDidRename.event
  private disposables: Disposable[] = []

  constructor(
    workspaceFolder: WorkspaceFolder,
    private watchmanPath: string,
    private channel: OutputChannel | undefined,
    private globPattern: string,
    public ignoreCreateEvents: boolean,
    public ignoreChangeEvents: boolean,
    public ignoreDeleteEvents: boolean,
  ) {
    workspaceFolder.workspaceFolders.forEach(folder => {
      let root = URI.parse(folder.uri).fsPath
      this.create(root)
    })
    workspaceFolder.onDidChangeWorkspaceFolders(e => {
      e.added.forEach(folder => {
        let root = URI.parse(folder.uri).fsPath
        this.create(root)
      })
    }, null, this.disposables)
  }

  private create(root: string): void {
    if (!root || !fs.existsSync(root) || this.watchmanPath == null) return
    Watchman.createClient(this.watchmanPath, root, this.channel).then(client => {
      if (this._disposed || !client) return
      this.listen(client)
    }).logError()
  }

  private listen(client: Watchman): void {
    let { globPattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents } = this
    const onChange = (change: FileChange) => {
      let { root, files } = change
      files = files.filter(f => f.type == 'f' && minimatch(f.name, globPattern, { dot: true }))
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
      if (files.length == 2 && !files[0].exists && files[1].exists) {
        let oldFile = files[0]
        let newFile = files[1]
        if (oldFile.size == newFile.size) {
          this._onDidRename.fire({
            oldUri: URI.file(path.join(root, oldFile.name)),
            newUri: URI.file(path.join(root, newFile.name))
          })
        }
      }
      // detect folder rename
      if (files.length >= 2) {
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
    client.subscribe(globPattern, onChange).then(disposable => {
      this.subscribe = disposable.subscribe
      if (this._disposed) return disposable.dispose()
      this.disposables.push(disposable)
    }).logError()
  }

  public dispose(): void {
    this._disposed = true
    this._watchedFolders.clear()
    this._onDidRename.dispose()
    this._onDidCreate.dispose()
    this._onDidChange.dispose()
    disposeAll(this.disposables)
  }
}
