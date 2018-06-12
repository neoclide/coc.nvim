import {
  EventEmitter,
  Event,
  Uri,
  Disposable,
} from '../util'
import Watchman, {FileChange} from '../watchman'
import path = require('path')
const logger = require('../util/logger')('filesystem-watcher')

export default class FileSystemWatcher implements Disposable {

  private subscription: string
  private _onDidCreate = new EventEmitter<Uri>()
  private _onDidChange = new EventEmitter<Uri>()
  private _onDidDelete = new EventEmitter<Uri>()
  private watchmanClient: Watchman

  public readonly onDidCreate: Event<Uri> = this._onDidCreate.event
  public readonly onDidChange: Event<Uri> = this._onDidChange.event
  public readonly onDidDelete: Event<Uri> = this._onDidDelete.event

  constructor(
    clientPromise:Promise<Watchman>,
    private globPattern:string,
    public ignoreCreateEvents:boolean,
    public ignoreChangeEvents:boolean,
    public ignoreDeleteEvents:boolean
  ) {
    clientPromise.then(client => {
      if (client) {
        this.watchmanClient = client
        return this.listen(client)
      }
    }).catch(error => {
      logger.error('watchman initailize failed')
      logger.error(error.stack)
    })
  }

  private async listen(client:Watchman):Promise<void> {
    let {globPattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents} = this
    this.subscription = await client.subscribe(globPattern, (change:FileChange) => {
      let {root, files} = change
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
    })
  }

  public dispose():void {
    if (this.watchmanClient && this.subscription) {
      this.watchmanClient.unsubscribe(this.subscription)
    }
  }
}
