import {
  EventEmitter,
  Event,
  Uri,
  Disposable,
} from '../util'
import path = require('path')
import {FSWatcher} from 'chokidar'
import chokidar = require('chokidar')
const logger = require('../util/logger')('filesystem-watcher')

export default class FileSystemWatcher implements Disposable {

  private _onDidCreate = new EventEmitter<Uri>()
  private _onDidChange = new EventEmitter<Uri>()
  private _onDidDelete = new EventEmitter<Uri>()
  private watcher:FSWatcher

  private readonly onDidCreateEvent: Event<Uri> = this._onDidCreate.event
  private readonly onDidChangeEvent: Event<Uri> = this._onDidChange.event
  private readonly onDidDeleteEvent: Event<Uri> = this._onDidDelete.event

  constructor(
    private root:string,
    private globPattern:string,
    public ignoreCreateEvents:boolean,
    public ignoreChangeEvents:boolean,
    public ignoreDeleteEvents:boolean
  ) {
    process.nextTick(() => {
      this.listen()
    })
  }

  private listen():void {
    let watcher = this.watcher = chokidar.watch(this.globPattern, {
      ignored: /(node_modules|\.git|\.hg)\//,
      persistent: true,
      followSymlinks: false,
      cwd: this.root
    })
    let {ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents} = this
    let ts = Date.now()
    if (!ignoreCreateEvents) {
      setTimeout(() => {
        watcher.on('add', p => {
          logger.debug(Date.now() - ts)
          let uri = Uri.file(path.join(this.root, p))
          this._onDidCreate.fire(uri)
        })
      }, 100)
    }
    if (!ignoreChangeEvents) {
      watcher.on('change', p => {
        let uri = Uri.file(path.join(this.root, p))
        this._onDidChange.fire(uri)
      })
    }
    if (!ignoreDeleteEvents) {
      watcher.on('unlink', p => {
        let uri = Uri.file(path.join(this.root, p))
        this._onDidDelete.fire(uri)
      })
    }
  }

  public dispose():void {
    if (this.watcher) {
      this.watcher.close()
    }
  }

  public onDidCreate(listener, thisArgs?, disposables?):void {
    this.onDidCreateEvent(listener, thisArgs, disposables)
  }

  public onDidChange(listener, thisArgs?, disposables?):void {
    this.onDidChangeEvent(listener, thisArgs, disposables)
  }
  public onDidDelete(listener, thisArgs?, disposables?):void {
    this.onDidDeleteEvent(listener, thisArgs, disposables)
  }
}
