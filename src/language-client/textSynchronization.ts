'use strict'
import type { ClientCapabilities, DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams, DidSaveTextDocumentParams, DocumentSelector, ProtocolNotificationType, RegistrationType, SaveOptions, ServerCapabilities, TextDocumentChangeRegistrationOptions, TextDocumentRegistrationOptions, TextDocumentSaveRegistrationOptions, TextDocumentSyncOptions, TextEdit, WillSaveTextDocumentParams } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { TextDocumentWillSaveEvent } from '../core/files'
import { DidChangeTextDocumentParams as TextDocumentChangeEvent } from '../types'
import { defaultValue, disposeAll } from '../util'
import { CancellationToken, DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, DidSaveTextDocumentNotification, Disposable, Emitter, Event, TextDocumentSyncKind, WillSaveTextDocumentNotification, WillSaveTextDocumentWaitUntilRequest } from '../util/protocol'
import workspace from '../workspace'
import { DynamicDocumentFeature, DynamicFeature, ensure, FeatureClient, NextSignature, NotificationSendEvent, NotifyingFeature, RegistrationData, TextDocumentEventFeature, TextDocumentSendFeature } from './features'
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

interface $ConfigurationOptions {
  textSynchronization?: {
    delayOpenNotifications?: boolean
  }
}

export class DidOpenTextDocumentFeature extends TextDocumentEventFeature<DidOpenTextDocumentParams, TextDocument, TextDocumentSynchronizationMiddleware> {
  private readonly _syncedDocuments: Map<string, TextDocument>
  private readonly _pendingOpenNotifications: Map<string, TextDocument>
  private readonly _delayOpen: boolean
  private _pendingOpenListeners: Disposable[] | undefined

  constructor(client: FeatureClient<TextDocumentSynchronizationMiddleware, $ConfigurationOptions>, syncedDocuments: Map<string, TextDocument>) {
    super(
      client,
      workspace.onDidOpenTextDocument,
      DidOpenTextDocumentNotification.type,
      'didOpen',
      textDocument => client.code2ProtocolConverter.asOpenTextDocumentParams(textDocument),
      TextDocumentEventFeature.textDocumentFilter
    )
    this._syncedDocuments = syncedDocuments
    this._pendingOpenNotifications = new Map<string, TextDocument>()
    this._delayOpen = defaultValue(defaultValue(client.clientOptions.textSynchronization, {}).delayOpenNotifications, false)
  }

  public async callback(document: TextDocument): Promise<void> {
    if (!this._delayOpen) {
      return super.callback(document)
    } else {
      if (!this.matches(document)) {
        return
      }
      const tabsModel = workspace.tabs
      if (tabsModel.isVisible(document)) {
        return super.callback(document)
      } else {
        this._pendingOpenNotifications.set(document.uri.toString(), document)
      }
    }
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'synchronization')!.dynamicRegistration = true
  }

  public get openDocuments(): IterableIterator<TextDocument> {
    return this._syncedDocuments.values()
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

  public get registrationType(): RegistrationType<TextDocumentRegistrationOptions> {
    return DidOpenTextDocumentNotification.type
  }

  public register(data: RegistrationData<TextDocumentRegistrationOptions>): void {
    super.register(data)
    if (!data.registerOptions.documentSelector) return
    const onError = error => {
      this._client.error(`Sending document notification ${this._type.method} failed`, error)
    }
    workspace.textDocuments.forEach(textDocument => {
      let uri = textDocument.uri
      if (!this._syncedDocuments.has(uri)) {
        this.callback(textDocument).catch(onError)
      }
    })
    if (this._delayOpen && this._pendingOpenListeners === undefined) {
      this._pendingOpenListeners = []
      const tabsModel = workspace.tabs
      this._pendingOpenListeners.push(tabsModel.onClose(closed => {
        for (const uri of closed) {
          this._pendingOpenNotifications.delete(uri.toString())
        }
      }))
      this._pendingOpenListeners.push(tabsModel.onOpen(opened => {
        for (const uri of opened) {
          const document = this._pendingOpenNotifications.get(uri.toString())
          if (document !== undefined) {
            super.callback(document).catch(onError)
            this._pendingOpenNotifications.delete(uri.toString())
          }
        }
      }))
      this._pendingOpenListeners.push(workspace.onDidCloseTextDocument(document => {
        this._pendingOpenNotifications.delete(document.uri)
      }))
    }
  }

  public async sendPendingOpenNotifications(closingDocument?: string): Promise<void> {
    if (!this._delayOpen) return
    const notifications = Array.from(this._pendingOpenNotifications.values())
    this._pendingOpenNotifications.clear()
    for (const notification of notifications) {
      if (closingDocument !== undefined && notification.uri.toString() === closingDocument) {
        continue
      }
      await super.callback(notification)
    }
  }

  protected notificationSent(textDocument: TextDocument, type: ProtocolNotificationType<DidOpenTextDocumentParams, TextDocumentRegistrationOptions>, params: DidOpenTextDocumentParams): void {
    super.notificationSent(textDocument, type, params)
    this._syncedDocuments.set(textDocument.uri.toString(), textDocument)
  }

  public dispose(): void {
    this._pendingOpenNotifications.clear()
    disposeAll(this._pendingOpenListeners ?? [])
    this._pendingOpenListeners = undefined
    super.dispose()
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
      'didClose',
      textDocument => client.code2ProtocolConverter.asCloseTextDocumentParams(textDocument),
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
    if (!selector) return
    // The super call removed the selector from the map
    // of selectors.
    super.unregister(id)
    let selectors = this._selectors.values()
    this._syncedDocuments.forEach(textDocument => {
      if (
        workspace.match(selector, textDocument) > 0 &&
        !this._selectorFilter!(selectors, textDocument)
      ) {
        this.sendNotification(textDocument).catch(error => {
          this._client.error(`Sending document notification ${this._type.method} failed`, error)
        })
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
    if (!data.registerOptions.documentSelector) return
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
    const promises: Promise<void>[] = []
    for (const changeData of this._changeData.values()) {
      if (workspace.match(changeData.documentSelector, event.document) > 0) {
        let middleware = this._client.middleware!
        let didChange: (event: TextDocumentChangeEvent) => Promise<void>
        const client = this._client
        if (changeData.syncKind === TextDocumentSyncKind.Incremental) {
          didChange = async (event: TextDocumentChangeEvent): Promise<void> => {
            const params = client.code2ProtocolConverter.asChangeTextDocumentParams(event)
            await this._client.sendNotification(DidChangeTextDocumentNotification.type, params)
            this.notificationSent(event, DidChangeTextDocumentNotification.type, params)
          }
        } else if (changeData.syncKind === TextDocumentSyncKind.Full) {
          didChange = async (event: TextDocumentChangeEvent): Promise<void> => {
            const params = client.code2ProtocolConverter.asFullChangeTextDocumentParams(event.document)
            await this._client.sendNotification(DidChangeTextDocumentNotification.type, params)
            this.notificationSent(event, DidChangeTextDocumentNotification.type, params)
          }
        }
        if (didChange) {
          promises.push(middleware.didChange ? middleware.didChange(event, didChange) : didChange(event))
        }
      }
    }
    return Promise.all(promises).then(undefined, error => {
      this._client.error(`Sending document notification ${DidChangeTextDocumentNotification.type.method} failed`, error)
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
      'willSave',
      willSaveEvent => client.code2ProtocolConverter.asWillSaveTextDocumentParams(willSaveEvent),
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
      documentSelector.length > 0 &&
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
    if (data.registerOptions.documentSelector) {
      if (!this._listener) {
        this._listener = workspace.onWillSaveTextDocument(this.callback, this)
      }
      this._selectors.set(data.id, data.registerOptions.documentSelector)
    }
  }

  private callback(event: TextDocumentWillSaveEvent): void {
    if (TextDocumentEventFeature.textDocumentFilter(
      this._selectors.values(),
      event.document)) {
      const client = this._client
      let middleware = this._client.middleware
      let willSaveWaitUntil = (event: TextDocumentWillSaveEvent): Thenable<TextEdit[]> => {
        return this.sendRequest(
          WillSaveTextDocumentWaitUntilRequest.type,
          client.code2ProtocolConverter.asWillSaveTextDocumentParams(event),
          CancellationToken.None
        )
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
      'didSave',
      textDocument => client.code2ProtocolConverter.asSaveTextDocumentParams(textDocument, this._includeText),
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
