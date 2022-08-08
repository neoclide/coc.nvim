'use strict'
import {
  ClientCapabilities, DidChangeWatchedFilesNotification, DidChangeWatchedFilesRegistrationOptions, Disposable, DocumentSelector, FileChangeType, FileEvent, RegistrationType,
  ServerCapabilities, WatchKind
} from 'vscode-languageserver-protocol'
import { FileSystemWatcher } from '../types'
import * as Is from '../util/is'
import workspace from '../workspace'
import { DynamicFeature, ensure, FeatureClient, FeatureState, RegistrationData } from './features'
import * as cv from './utils/converter'

export class FileSystemWatcherFeature implements DynamicFeature<DidChangeWatchedFilesRegistrationOptions> {
  private _watchers: Map<string, Disposable[]> = new Map<string, Disposable[]>()

  constructor(
    _client: FeatureClient<object>,
    private _notifyFileEvent: (event: FileEvent) => void
  ) {}

  public getState(): FeatureState {
    return { kind: 'workspace', id: this.registrationType.method, registrations: this._watchers.size > 0 }
  }

  public get registrationType(): RegistrationType<DidChangeWatchedFilesRegistrationOptions> {
    return DidChangeWatchedFilesNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'workspace')!, 'didChangeWatchedFiles')!.dynamicRegistration = true
  }

  public initialize(
    _capabilities: ServerCapabilities,
    _documentSelector: DocumentSelector
  ): void {}

  public register(
    data: RegistrationData<DidChangeWatchedFilesRegistrationOptions>
  ): void {
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
        watchChange = (watcher.kind & WatchKind.Change) != 0
        watchDelete = (watcher.kind & WatchKind.Delete) != 0
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

  public registerRaw(id: string, fileSystemWatchers: FileSystemWatcher[]) {
    let disposables: Disposable[] = []
    for (let fileSystemWatcher of fileSystemWatchers) {
      disposables.push(fileSystemWatcher)
      this.hookListeners(fileSystemWatcher, true, true, true, disposables)
    }
    this._watchers.set(id, disposables)
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
          this._notifyFileEvent({
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
          this._notifyFileEvent({
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
          this._notifyFileEvent({
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
    }
  }

  public dispose(): void {
    this._watchers.forEach(disposables => {
      for (let disposable of disposables) {
        disposable.dispose()
      }
    })
    this._watchers.clear()
  }
}
