import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Watchman, { FileChange } from '../watchman'
import path = require('path')
import { RenameEvent } from '../types'
import { disposeAll } from '../util'
const logger = require('../util/logger')('filesystem-watcher')

export default class FileSystemWatcher implements Disposable {

  private _onDidCreate = new Emitter<Uri>()
  private _onDidChange = new Emitter<Uri>()
  private _onDidDelete = new Emitter<Uri>()
  private _onDidRename = new Emitter<RenameEvent>()

  public readonly onDidCreate: Event<Uri> = this._onDidCreate.event
  public readonly onDidChange: Event<Uri> = this._onDidChange.event
  public readonly onDidDelete: Event<Uri> = this._onDidDelete.event
  public readonly onDidRename: Event<RenameEvent> = this._onDidRename.event
  private disposables: Disposable[] = []

  constructor(
    clientPromise: Promise<Watchman> | null,
    private globPattern: string,
    public ignoreCreateEvents: boolean,
    public ignoreChangeEvents: boolean,
    public ignoreDeleteEvents: boolean
  ) {
    if (!clientPromise) return
    clientPromise.then(client => {
      if (client) return this.listen(client)
    }).catch(error => {
      logger.error('watchman initialize failed')
      logger.error(error.stack)
    })
  }

  private async listen(client: Watchman): Promise<Disposable> {
    let { globPattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents } = this
    let disposable = await client.subscribe(globPattern, (change: FileChange) => {
      let { root, files } = change
      files = files.filter(f => f.type == 'f')
      for (let file of files) {
        let uri = Uri.file(path.join(root, file.name))
        if (!file.exists) {
          if (!ignoreDeleteEvents) this._onDidDelete.fire(uri)
        } else {
          if (file.size != 0) {
            if (!ignoreChangeEvents) this._onDidChange.fire(uri)
          } else {
            if (!ignoreCreateEvents) this._onDidCreate.fire(uri)
          }
        }
      }
      if (files.length == 2 && !files[0].exists && files[1].exists) {
        let oldFile = files[0]
        let newFile = files[1]
        if (oldFile.size == newFile.size) {
          this._onDidRename.fire({
            oldUri: Uri.file(path.join(root, oldFile.name)),
            newUri: Uri.file(path.join(root, newFile.name))
          })
        }
      }
    })
    this.disposables.push(disposable)
    return disposable
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
