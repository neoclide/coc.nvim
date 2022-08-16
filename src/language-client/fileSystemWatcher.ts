'use strict'
import debounce from 'debounce'
import {
  ClientCapabilities, DidChangeWatchedFilesNotification, DidChangeWatchedFilesRegistrationOptions, Disposable, DocumentSelector, FileChangeType, FileEvent, RegistrationType,
  ServerCapabilities, WatchKind
} from 'vscode-languageserver-protocol'
import { FileSystemWatcher } from '../types'
import * as Is from '../util/is'
import workspace from '../workspace'
import { DynamicFeature, ensure, FeatureClient, FeatureState, RegistrationData } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'
const logger = require('../util/logger')('language-client-fileSystemWatcher')

export interface DidChangeWatchedFileSignature {
  (this: void, event: FileEvent): void
}

export interface FileSystemWatcherMiddleware {
  didChangeWatchedFile?: (this: void, event: FileEvent, next: DidChangeWatchedFileSignature) => Promise<void>
}

interface _FileSystemWatcherMiddleware {
  workspace?: FileSystemWatcherMiddleware
}

interface $FileEventOptions {
  synchronize?: {
    fileEvents?: FileSystemWatcher | FileSystemWatcher[]
  }
}

export class FileSystemWatcherFeature implements DynamicFeature<DidChangeWatchedFilesRegistrationOptions> {
  private _watchers: Map<string, Disposable[]> = new Map<string, Disposable[]>()
  private _fileEventsMap: Map<string, FileEvent> = new Map()
  public debouncedFileNotify: Function & { clear(): void }

  constructor(private _client: FeatureClient<_FileSystemWatcherMiddleware, $FileEventOptions>) {
    this.debouncedFileNotify = debounce(() => {
      void this._notifyFileEvent()
    }, global.__TEST__ ? 20 : 200)
  }

  public async _notifyFileEvent(): Promise<void> {
    let map = this._fileEventsMap
    if (map.size == 0) return
    await this._client.forceDocumentSync()
    this._client.sendNotification(DidChangeWatchedFilesNotification.type, { changes: Array.from(map.values()) }).catch(error => {
      this._client.error(`Notify file events failed.`, error)
    })
    map.clear()
  }

  private notifyFileEvent(event: FileEvent): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let self = this
    function didChangeWatchedFile(event: FileEvent): void {
      self._fileEventsMap.set(event.uri, event)
      self.debouncedFileNotify()
    }
    const workSpaceMiddleware = this._client.middleware?.workspace
    if (workSpaceMiddleware.didChangeWatchedFile) {
      void workSpaceMiddleware.didChangeWatchedFile(event, didChangeWatchedFile)
    } else {
      didChangeWatchedFile(event)
    }
  }

  public getState(): FeatureState {
    return { kind: 'workspace', id: this.registrationType.method, registrations: this._watchers.size > 0 }
  }

  public get registrationType(): RegistrationType<DidChangeWatchedFilesRegistrationOptions> {
    return DidChangeWatchedFilesNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'workspace')!, 'didChangeWatchedFiles')!.dynamicRegistration = true
    // ensure(ensure(capabilities, 'workspace')!, 'didChangeWatchedFiles')!.relativePatternSupport = true
  }

  public initialize(_capabilities: ServerCapabilities, _documentSelector: DocumentSelector): void {
    let fileEvents = this._client.clientOptions.synchronize?.fileEvents
    if (!fileEvents) return
    let watchers: FileSystemWatcher[] = Array.isArray(fileEvents) ? fileEvents : [fileEvents]
    let disposables: Disposable[] = []
    for (let fileSystemWatcher of watchers) {
      disposables.push(fileSystemWatcher)
      this.hookListeners(
        fileSystemWatcher,
        !fileSystemWatcher.ignoreCreateEvents,
        !fileSystemWatcher.ignoreChangeEvents,
        !fileSystemWatcher.ignoreDeleteEvents,
        disposables)
    }
    this._watchers.set(UUID.generateUuid(), disposables)
  }

  public register(data: RegistrationData<DidChangeWatchedFilesRegistrationOptions>): void {
    if (!Array.isArray(data.registerOptions.watchers)) {
      return
    }
    let disposables: Disposable[] = []
    for (let watcher of data.registerOptions.watchers) {
      if (!Is.string(watcher.globPattern)) {
        continue
      }
      let watchCreate = true
      let watchChange = true
      let watchDelete = true
      if (watcher.kind != null) {
        watchCreate = (watcher.kind & WatchKind.Create) !== 0
        watchChange = (watcher.kind & WatchKind.Change) !== 0
        watchDelete = (watcher.kind & WatchKind.Delete) !== 0
      }
      let fileSystemWatcher = workspace.createFileSystemWatcher(
        watcher.globPattern,
        !watchCreate,
        !watchChange,
        !watchDelete
      )
      this.hookListeners(
        fileSystemWatcher,
        watchCreate,
        watchChange,
        watchDelete,
        disposables
      )
      disposables.push(fileSystemWatcher)
    }
    this._watchers.set(data.id, disposables)
  }

  private hookListeners(
    fileSystemWatcher: FileSystemWatcher,
    watchCreate: boolean,
    watchChange: boolean,
    watchDelete: boolean,
    listeners: Disposable[]
  ): void {
    if (watchCreate) {
      fileSystemWatcher.onDidCreate(
        resource =>
          this.notifyFileEvent({
            uri: cv.asUri(resource),
            type: FileChangeType.Created
          }),
        null,
        listeners
      )
    }
    if (watchChange) {
      fileSystemWatcher.onDidChange(
        resource =>
          this.notifyFileEvent({
            uri: cv.asUri(resource),
            type: FileChangeType.Changed
          }),
        null,
        listeners
      )
    }
    if (watchDelete) {
      fileSystemWatcher.onDidDelete(
        resource =>
          this.notifyFileEvent({
            uri: cv.asUri(resource),
            type: FileChangeType.Deleted
          }),
        null,
        listeners
      )
    }
  }

  public unregister(id: string): void {
    let disposables = this._watchers.get(id)
    if (disposables) {
      for (let disposable of disposables) {
        disposable.dispose()
      }
      this._watchers.delete(id)
    }
  }

  public dispose(): void {
    this._fileEventsMap.clear()
    this.debouncedFileNotify.clear()
    this._watchers.forEach(disposables => {
      for (let disposable of disposables) {
        disposable.dispose()
      }
    })
    this._watchers.clear()
  }
}
