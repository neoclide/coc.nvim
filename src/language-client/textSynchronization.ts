'use strict'
import { ClientCapabilities, DidChangeTextDocumentNotification, DidChangeTextDocumentParams, DidCloseTextDocumentNotification, DidCloseTextDocumentParams, DidOpenTextDocumentNotification, DidOpenTextDocumentParams, DidSaveTextDocumentNotification, DidSaveTextDocumentParams, Disposable, DocumentSelector, Emitter, Event, ProtocolNotificationType, RegistrationType, SaveOptions, ServerCapabilities, TextDocumentChangeRegistrationOptions, TextDocumentRegistrationOptions, TextDocumentSaveRegistrationOptions, TextDocumentSyncKind, TextDocumentSyncOptions, TextEdit, WillSaveTextDocumentNotification, WillSaveTextDocumentParams, WillSaveTextDocumentWaitUntilRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DidChangeTextDocumentParams as TextDocumentChangeEvent, TextDocumentWillSaveEvent } from '../types'
import workspace from '../workspace'
import { DynamicDocumentFeature, DynamicFeature, ensure, FeatureClient, NextSignature, NotificationSendEvent, NotifyingFeature, RegistrationData, TextDocumentEventFeature, TextDocumentSendFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface TextDocumentSynchronizationMiddleware {
  didOpen?: NextSignature<TextDocument, Promise<void>>
  didChange?: NextSignature<TextDocumentChangeEvent, Promise<void>>
  willSave?: NextSignature<TextDocumentWillSaveEvent, Promise<void>>
  willSaveWaitUntil?: NextSignature<TextDocumentWillSaveEvent, Thenable<TextEdit[]>>
  didSave?: NextSignature<TextDocument, Promise<void>>
  didClose?: NextSignature<TextDocument, Promise<void>>
}

export interface ResolvedTextDocumentSyncCapabilities {
  resolvedTextDocumentSync?: TextDocumentSyncOptions
}

export interface DidOpenTextDocumentFeatureShape extends DynamicFeature<TextDocumentRegistrationOptions>, TextDocumentSendFeature<(textDocument: TextDocument) => Promise<void>>, NotifyingFeature<TextDocument, DidOpenTextDocumentParams> {
  openDocuments: Iterable<TextDocument>
}

export interface DidChangeTextDocumentFeatureShape extends DynamicFeature<TextDocumentChangeRegistrationOptions>, TextDocumentSendFeature<(event: TextDocumentChangeEvent) => Promise<void>>, NotifyingFeature<TextDocumentChangeEvent, DidChangeTextDocumentParams> {
}

export interface DidSaveTextDocumentFeatureShape extends DynamicFeature<TextDocumentRegistrationOptions>, TextDocumentSendFeature<(textDocument: TextDocument) => Promise<void>>, NotifyingFeature<TextDocument, DidSaveTextDocumentParams> {
}

export interface DidCloseTextDocumentFeatureShape extends DynamicFeature<TextDocumentRegistrationOptions>, TextDocumentSendFeature<(textDocument: TextDocument) => Promise<void>>, NotifyingFeature<TextDocument, DidCloseTextDocumentParams> {
}

export class DidOpenTextDocumentFeature extends TextDocumentEventFeature<DidOpenTextDocumentParams, TextDocument, TextDocumentSynchronizationMiddleware> {
  constructor(client: FeatureClient<TextDocumentSynchronizationMiddleware>, private _syncedDocuments: Map<string, TextDocument>) {
    super(
      client,
      workspace.onDidOpenTextDocument,
      DidOpenTextDocumentNotification.type,
      () => client.middleware.didOpen,
      textDocument => cv.asOpenTextDocumentParams(textDocument),
      data => data,
      TextDocumentEventFeature.textDocumentFilter
    )
  }

  public get registrationType(): RegistrationType<TextDocumentRegistrationOptions> {
    return DidOpenTextDocumentNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'synchronization')!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    let textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (documentSelector && textDocumentSyncOptions && textDocumentSyncOptions.openClose) {
      this.register({
        id: UUID.generateUuid(),
        registerOptions: { documentSelector }
      })
    }
  }

  public register(
    data: RegistrationData<TextDocumentRegistrationOptions>
  ): void {
    super.register(data)
    if (!data.registerOptions.documentSelector) {
      return
    }
    let documentSelector = data.registerOptions.documentSelector
    workspace.textDocuments.forEach(textDocument => {
      let uri: string = textDocument.uri.toString()
      if (this._syncedDocuments.has(uri)) {
        return
      }
      if (workspace.match(documentSelector, textDocument) > 0) {
        let middleware = this._client.middleware!
        let didOpen = (textDocument: TextDocument) => {
          return this._client.sendNotification(
            this._type,
            this._createParams(textDocument)
          )
        }
        let promise: Promise<void>
        if (middleware.didOpen) {
          promise = middleware.didOpen(textDocument, didOpen)
        } else {
          promise = didOpen(textDocument)
        }
        if (promise) {
          promise.catch(error => {
            this._client.error(`Sending document notification ${this._type.method} failed`, error)
          })
        }
        this._syncedDocuments.set(uri, textDocument)
      }
    })
  }

  protected notificationSent(textDocument: TextDocument, type: ProtocolNotificationType<DidOpenTextDocumentParams, TextDocumentRegistrationOptions>, params: DidOpenTextDocumentParams): void {
    super.notificationSent(textDocument, type, params)
    this._syncedDocuments.set(textDocument.uri.toString(), textDocument)
  }
}

export class DidCloseTextDocumentFeature extends TextDocumentEventFeature<DidCloseTextDocumentParams, TextDocument, TextDocumentSynchronizationMiddleware> implements DidCloseTextDocumentFeatureShape {
  constructor(
    client: FeatureClient<TextDocumentSynchronizationMiddleware>,
    private _syncedDocuments: Map<string, TextDocument>
  ) {
    super(
      client,
      workspace.onDidCloseTextDocument,
      DidCloseTextDocumentNotification.type,
      () => client.middleware!.didClose,
      textDocument => cv.asCloseTextDocumentParams(textDocument),
      data => data,
      TextDocumentEventFeature.textDocumentFilter
    )
  }

  public get registrationType(): RegistrationType<TextDocumentRegistrationOptions> {
    return DidCloseTextDocumentNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'textDocument')!,
      'synchronization'
    )!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    let textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (
      documentSelector &&
      textDocumentSyncOptions &&
      textDocumentSyncOptions.openClose
    ) {
      this.register({
        id: UUID.generateUuid(),
        registerOptions: { documentSelector }
      })
    }
  }

  protected notificationSent(textDocument: TextDocument, type: ProtocolNotificationType<DidCloseTextDocumentParams, TextDocumentRegistrationOptions>, params: DidCloseTextDocumentParams): void {
    super.notificationSent(textDocument, type, params)
    this._syncedDocuments.delete(textDocument.uri.toString())
  }

  public unregister(id: string): void {
    let selector = this._selectors.get(id)!
    // The super call removed the selector from the map
    // of selectors.
    super.unregister(id)
    let selectors = this._selectors.values()
    this._syncedDocuments.forEach(textDocument => {
      if (
        workspace.match(selector, textDocument) > 0 &&
        !this._selectorFilter!(selectors, textDocument)
      ) {
        let middleware = this._client.middleware!
        let didClose = (textDocument: TextDocument) => {
          return this._client.sendNotification(this._type, this._createParams(textDocument))
        }
        this._syncedDocuments.delete(textDocument.uri.toString())
        let promise = middleware.didClose ? middleware.didClose(textDocument, didClose) : didClose(textDocument)
        if (promise) {
          promise.catch(error => {
            this._client.error(`Sending document notification ${this._type.method} failed`, error)
          })
        }
      }
    })
  }
}

interface DidChangeTextDocumentData {
  syncKind: 0 | 1 | 2
  documentSelector: DocumentSelector
}

export class DidChangeTextDocumentFeature extends DynamicDocumentFeature<TextDocumentChangeRegistrationOptions, TextDocumentSynchronizationMiddleware> implements DidChangeTextDocumentFeatureShape {
  private _listener: Disposable | undefined
  private readonly _changeData: Map<string, DidChangeTextDocumentData>
  private _onNotificationSent: Emitter<NotificationSendEvent<TextDocumentChangeEvent, DidChangeTextDocumentParams>>

  constructor(client: FeatureClient<TextDocumentSynchronizationMiddleware>) {
    super(client)
    this._changeData = new Map<string, DidChangeTextDocumentData>()
    this._onNotificationSent = new Emitter()
  }

  public *getDocumentSelectors(): IterableIterator<DocumentSelector> {
    for (const data of this._changeData.values()) {
      yield data.documentSelector
    }
  }

  public get registrationType(): RegistrationType<TextDocumentChangeRegistrationOptions> {
    return DidChangeTextDocumentNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'synchronization')!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    let textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (
      documentSelector &&
      textDocumentSyncOptions &&
      textDocumentSyncOptions.change !== undefined &&
      textDocumentSyncOptions.change !== TextDocumentSyncKind.None
    ) {
      this.register({
        id: UUID.generateUuid(),
        registerOptions: Object.assign(
          {},
          { documentSelector },
          { syncKind: textDocumentSyncOptions.change }
        )
      })
    }
  }

  public register(
    data: RegistrationData<TextDocumentChangeRegistrationOptions>
  ): void {
    if (!data.registerOptions.documentSelector) {
      return
    }
    if (!this._listener) {
      this._listener = workspace.onDidChangeTextDocument(this.callback, this)
    }
    this._changeData.set(data.id, {
      documentSelector: data.registerOptions.documentSelector,
      syncKind: data.registerOptions.syncKind
    })
  }

  private callback(event: TextDocumentChangeEvent): Promise<void> {
    // Text document changes are send for dirty changes as well. We don't
    // have dirty / undirty events in the LSP so we ignore content changes
    // with length zero.
    if (event.contentChanges.length === 0) {
      return
    }
    let doc = workspace.getDocument(event.textDocument.uri)
    if (!doc) return
    let { textDocument } = doc
    const promises: Promise<void>[] = []
    for (const changeData of this._changeData.values()) {
      if (workspace.match(changeData.documentSelector, textDocument) > 0) {
        let middleware = this._client.middleware!
        let promise: Promise<void> | undefined
        if (changeData.syncKind === TextDocumentSyncKind.Incremental) {
          let didChange = async (event): Promise<void> => {
            const params = cv.asChangeTextDocumentParams(event)
            await this._client.sendNotification(DidChangeTextDocumentNotification.type, params)
            this.notificationSent(event, DidChangeTextDocumentNotification.type, params)
          }
          promise = middleware.didChange ? middleware.didChange(event, didChange) : didChange(event)
        } else if (changeData.syncKind === TextDocumentSyncKind.Full) {
          let didChange = async (event: TextDocumentChangeEvent): Promise<void> => {
            const params = cv.asFullChangeTextDocumentParams(textDocument)
            await this._client.sendNotification(DidChangeTextDocumentNotification.type, params)
            this.notificationSent(event, DidChangeTextDocumentNotification.type, params)
          }
          promise = middleware.didChange ? middleware.didChange(event, didChange) : didChange(event)
        }
        if (promise) promises.push(promise)
      }
    }
    return Promise.all(promises).then(undefined, error => {
      this._client.error(`Sending document notification ${DidChangeTextDocumentNotification.type.method} failed`, error)
      throw error
    })
  }

  public get onNotificationSent(): Event<NotificationSendEvent<TextDocumentChangeEvent, DidChangeTextDocumentParams>> {
    return this._onNotificationSent.event
  }

  private notificationSent(changeEvent: TextDocumentChangeEvent, type: ProtocolNotificationType<DidChangeTextDocumentParams, TextDocumentRegistrationOptions>, params: DidChangeTextDocumentParams): void {
    this._onNotificationSent.fire({ original: changeEvent, type, params })
  }

  public unregister(id: string): void {
    this._changeData.delete(id)
    if (this._changeData.size === 0 && this._listener) {
      this._listener.dispose()
      this._listener = undefined
    }
  }

  public dispose(): void {
    this._changeData.clear()
    if (this._listener) {
      this._listener.dispose()
      this._listener = undefined
    }
  }

  public getProvider(document: TextDocument): { send: (event: TextDocumentChangeEvent) => Promise<void> } | undefined {
    for (const changeData of this._changeData.values()) {
      if (workspace.match(changeData.documentSelector, document) > 0) {
        return {
          send: (event: TextDocumentChangeEvent): Promise<void> => {
            return this.callback(event)
          }
        }
      }
    }
    return undefined
  }
}

export class WillSaveFeature extends TextDocumentEventFeature<WillSaveTextDocumentParams, TextDocumentWillSaveEvent, TextDocumentSynchronizationMiddleware> {
  constructor(client: FeatureClient<TextDocumentSynchronizationMiddleware>) {
    super(
      client,
      workspace.onWillSaveTextDocument,
      WillSaveTextDocumentNotification.type,
      () => client.middleware.willSave,
      willSaveEvent => cv.asWillSaveTextDocumentParams(willSaveEvent),
      event => event.document,
      (selectors, willSaveEvent) => TextDocumentEventFeature.textDocumentFilter(selectors, willSaveEvent.document)
    )
  }

  public get registrationType(): RegistrationType<TextDocumentRegistrationOptions> {
    return WillSaveTextDocumentNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let value = ensure(ensure(capabilities, 'textDocument')!, 'synchronization')!
    value.willSave = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    let textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (
      documentSelector &&
      textDocumentSyncOptions &&
      textDocumentSyncOptions.willSave
    ) {
      this.register({
        id: UUID.generateUuid(),
        registerOptions: { documentSelector }
      })
    }
  }
}

export class WillSaveWaitUntilFeature extends DynamicDocumentFeature<TextDocumentRegistrationOptions, TextDocumentSynchronizationMiddleware> {
  private _listener: Disposable | undefined
  private _selectors: Map<string, DocumentSelector>

  constructor(client: FeatureClient<TextDocumentSynchronizationMiddleware>) {
    super(client)
    this._selectors = new Map<string, DocumentSelector>()
  }

  protected getDocumentSelectors(): IterableIterator<DocumentSelector> {
    return this._selectors.values()
  }

  public get registrationType(): RegistrationType<TextDocumentRegistrationOptions> {
    return WillSaveTextDocumentWaitUntilRequest.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let value = ensure(ensure(capabilities, 'textDocument')!, 'synchronization')!
    value.willSaveWaitUntil = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    let textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (
      documentSelector &&
      textDocumentSyncOptions &&
      textDocumentSyncOptions.willSaveWaitUntil
    ) {
      this.register({
        id: UUID.generateUuid(),
        registerOptions: { documentSelector }
      })
    }
  }

  public register(
    data: RegistrationData<TextDocumentRegistrationOptions>
  ): void {
    if (!data.registerOptions.documentSelector) {
      return
    }
    if (!this._listener) {
      this._listener = workspace.onWillSaveTextDocument(this.callback, this)
    }
    this._selectors.set(data.id, data.registerOptions.documentSelector)
  }

  private callback(event: TextDocumentWillSaveEvent): void {
    if (TextDocumentEventFeature.textDocumentFilter(
      this._selectors.values(),
      event.document)) {
      let middleware = this._client.middleware!
      let willSaveWaitUntil = (event: TextDocumentWillSaveEvent): Thenable<TextEdit[]> => {
        return this._client
          .sendRequest(
            WillSaveTextDocumentWaitUntilRequest.type,
            cv.asWillSaveTextDocumentParams(event)
          )
          .then(edits => {
            return Array.isArray(edits) ? edits : []
          })
      }
      event.waitUntil(
        middleware.willSaveWaitUntil
          ? middleware.willSaveWaitUntil(event, willSaveWaitUntil)
          : willSaveWaitUntil(event)
      )
    }
  }

  public unregister(id: string): void {
    this._selectors.delete(id)
    if (this._selectors.size === 0 && this._listener) {
      this._listener.dispose()
      this._listener = undefined
    }
  }

  public dispose(): void {
    this._selectors.clear()
    if (this._listener) {
      this._listener.dispose()
      this._listener = undefined
    }
  }
}

export class DidSaveTextDocumentFeature extends TextDocumentEventFeature<DidSaveTextDocumentParams, TextDocument, TextDocumentSynchronizationMiddleware> implements DidSaveTextDocumentFeatureShape {
  private _includeText: boolean

  constructor(client: FeatureClient<TextDocumentSynchronizationMiddleware>) {
    super(
      client, workspace.onDidSaveTextDocument, DidSaveTextDocumentNotification.type,
      () => client.middleware.didSave,
      textDocument => cv.asSaveTextDocumentParams(textDocument, this._includeText),
      data => data,
      TextDocumentEventFeature.textDocumentFilter
    )
    this._includeText = false
  }

  public get registrationType(): RegistrationType<TextDocumentSaveRegistrationOptions> {
    return DidSaveTextDocumentNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'synchronization')!.didSave = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (documentSelector && textDocumentSyncOptions && textDocumentSyncOptions.save) {
      const saveOptions: SaveOptions = typeof textDocumentSyncOptions.save === 'boolean'
        ? { includeText: false }
        : { includeText: !!textDocumentSyncOptions.save.includeText }
      this.register({
        id: UUID.generateUuid(),
        registerOptions: Object.assign({}, { documentSelector }, saveOptions)
      })
    }
  }

  public register(data: RegistrationData<TextDocumentSaveRegistrationOptions>): void {
    this._includeText = !!data.registerOptions.includeText
    super.register(data)
  }
}