'use strict'
import type {
  ClientCapabilities, DidChangeWatchedFilesRegistrationOptions, Disposable, DocumentSelector, FileEvent, RegistrationType,
  ServerCapabilities
} from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import RelativePatternImpl from '../model/relativePattern'
import { GlobPattern, IFileSystemWatcher } from '../types'
import { defaultValue, disposeAll } from '../util'
import * as Is from '../util/is'
import { DidChangeWatchedFilesNotification, FileChangeType, RelativePattern, WatchKind } from '../util/protocol'
import workspace from '../workspace'
import { DynamicFeature, ensure, FeatureClient, FeatureState, RegistrationData } from './features'
import * as UUID from './utils/uuid'

export interface DidChangeWatchedFileSignature {
  (this: void, event: FileEvent): void
}

interface $FileEventOptions {
  synchronize?: {
    fileEvents?: IFileSystemWatcher | IFileSystemWatcher[]
  }
}

export function asRelativePattern(rp: RelativePattern): RelativePatternImpl {
  let { baseUri, pattern } = rp
  if (typeof baseUri === 'string') {
    return new RelativePatternImpl(URI.parse(baseUri), pattern)
  }
  return new RelativePatternImpl(baseUri, pattern)
}

export class FileSystemWatcherFeature implements DynamicFeature<DidChangeWatchedFilesRegistrationOptions> {
  private _watchers: Map<string, Disposable[]> = new Map<string, Disposable[]>()
  private _fileEventsMap: Map<string, FileEvent> = new Map()
  private readonly _client: FeatureClient<object, $FileEventOptions>
  private readonly _notifyFileEvent: (event: FileEvent) => void

  constructor(client: FeatureClient<object, $FileEventOptions>, notifyFileEvent: (event: FileEvent) => void) {
    this._client = client
    this._notifyFileEvent = notifyFileEvent
    this._watchers = new Map<string, Disposable[]>()
  }

  public getState(): FeatureState {
    return { kind: 'workspace', id: this.registrationType.method, registrations: this._watchers.size > 0 }
  }

  public get registrationType(): RegistrationType<DidChangeWatchedFilesRegistrationOptions> {
    return DidChangeWatchedFilesNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'workspace')!, 'didChangeWatchedFiles')!.dynamicRegistration = true
    ensure(ensure(capabilities, 'workspace')!, 'didChangeWatchedFiles')!.relativePatternSupport = true
  }

  public initialize(_capabilities: ServerCapabilities, _documentSelector: DocumentSelector): void {
    let fileEvents = defaultValue(this._client.clientOptions.synchronize, {}).fileEvents
    if (!fileEvents) return
    let watchers: IFileSystemWatcher[] = Array.isArray(fileEvents) ? fileEvents : [fileEvents]
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
      let globPattern: GlobPattern
      if (Is.string(watcher.globPattern)) {
        globPattern = watcher.globPattern
      } else if (RelativePattern.is(watcher.globPattern)) {
        globPattern = asRelativePattern(watcher.globPattern)
      } else {
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
        globPattern,
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
    fileSystemWatcher: IFileSystemWatcher,
    watchCreate: boolean,
    watchChange: boolean,
    watchDelete: boolean,
    listeners: Disposable[]
  ): void {
    const client = this._client
    // TODO rename support
    if (watchCreate) {
      fileSystemWatcher.onDidCreate(
        resource =>
          this._notifyFileEvent({
            uri: client.code2ProtocolConverter.asUri(resource),
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
            uri: client.code2ProtocolConverter.asUri(resource),
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
            uri: client.code2ProtocolConverter.asUri(resource),
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
      this._watchers.delete(id)
      disposeAll(disposables)
    }
  }

  public dispose(): void {
    this._fileEventsMap.clear()
    this._watchers.forEach(disposables => {
      disposeAll(disposables)
    })
    this._watchers.clear()
  }
}
