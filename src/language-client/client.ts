'use strict'
import type { ApplyWorkspaceEditParams, ApplyWorkspaceEditResult, CallHierarchyPrepareRequest, CancellationStrategy, CancellationToken, ClientCapabilities, CodeActionRequest, CodeLensRequest, CompletionRequest, ConfigurationRequest, ConnectionStrategy, DeclarationRequest, DefinitionRequest, DidChangeConfigurationNotification, DidChangeConfigurationRegistrationOptions, DidChangeTextDocumentNotification, DidChangeWatchedFilesNotification, DidChangeWatchedFilesRegistrationOptions, DidChangeWorkspaceFoldersNotification, DidCloseTextDocumentNotification, DidCreateFilesNotification, DidDeleteFilesNotification, DidOpenTextDocumentNotification, DidRenameFilesNotification, DidSaveTextDocumentNotification, Disposable, DocumentColorRequest, DocumentDiagnosticRequest, DocumentFormattingRequest, DocumentHighlightRequest, DocumentLinkRequest, DocumentOnTypeFormattingRequest, DocumentRangeFormattingRequest, DocumentSelector, DocumentSymbolRequest, ExecuteCommandRegistrationOptions, ExecuteCommandRequest, FileOperationRegistrationOptions, FoldingRangeRequest, GenericNotificationHandler, GenericRequestHandler, HoverRequest, ImplementationRequest, InitializeParams, InitializeResult, InlineValueRequest, LinkedEditingRangeRequest, Message, MessageActionItem, MessageSignature, NotificationHandler, NotificationHandler0, NotificationType, NotificationType0, ProgressToken, ProgressType, ProtocolNotificationType, ProtocolNotificationType0, ProtocolRequestType, ProtocolRequestType0, PublishDiagnosticsParams, ReferencesRequest, RegistrationParams, RenameRequest, RequestHandler, RequestHandler0, RequestType, RequestType0, SelectionRangeRequest, SemanticTokensRegistrationType, ServerCapabilities, ShowDocumentParams, ShowDocumentResult, ShowMessageRequestParams, SignatureHelpRequest, TextDocumentRegistrationOptions, TextDocumentSyncOptions, TextEdit, TraceOptions, Tracer, TypeDefinitionRequest, TypeHierarchyPrepareRequest, UnregistrationParams, WillCreateFilesRequest, WillDeleteFilesRequest, WillRenameFilesRequest, WillSaveTextDocumentNotification, WillSaveTextDocumentWaitUntilRequest, WorkDoneProgressBegin, WorkDoneProgressCreateRequest, WorkDoneProgressEnd, WorkDoneProgressReport, WorkspaceEdit, WorkspaceSymbolRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, MarkupKind, TextDocumentEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent, TextDocumentWillSaveEvent } from '../core/files'
import DiagnosticCollection from '../diagnostic/collection'
import languages from '../languages'
import { createLogger } from '../logger'
import type { MessageItem } from '../model/notification'
import { CallHierarchyProvider, CodeActionProvider, CompletionItemProvider, DeclarationProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentHighlightProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentSymbolProvider, FoldingRangeProvider, HoverProvider, ImplementationProvider, LinkedEditingRangeProvider, OnTypeFormattingEditProvider, ProviderResult, ReferenceProvider, RenameProvider, SelectionRangeProvider, SignatureHelpProvider, TypeDefinitionProvider, TypeHierarchyProvider, WorkspaceSymbolProvider } from '../provider'
import { OutputChannel, Thenable } from '../types'
import { defaultValue } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { CancellationError } from '../util/errors'
import { sameFile } from '../util/fs'
import * as Is from '../util/is'
import { os, path } from '../util/node'
import { comparePosition } from '../util/position'
import {
  ApplyWorkspaceEditRequest, createProtocolConnection, Emitter, ErrorCodes, Event, ExitNotification, FailureHandlingKind, InitializedNotification, InitializeRequest, InlayHintRequest, LogMessageNotification, LSPErrorCodes, MessageReader, MessageType, MessageWriter, PositionEncodingKind, PublishDiagnosticsNotification, RegistrationRequest, ResourceOperationKind, ResponseError, SemanticTokensDeltaRequest, SemanticTokensRangeRequest, SemanticTokensRequest, ShowDocumentRequest, ShowMessageNotification, ShowMessageRequest, ShutdownRequest, TextDocumentSyncKind, Trace, TraceFormat, UnregistrationRequest, WorkDoneProgress
} from '../util/protocol'
import { toText } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { CallHierarchyFeature, CallHierarchyMiddleware } from './callHierarchy'
import { CodeActionFeature, CodeActionMiddleware } from './codeAction'
import { CodeLensFeature, CodeLensMiddleware, CodeLensProviderShape } from './codeLens'
import { ColorProviderFeature, ColorProviderMiddleware } from './colorProvider'
import { $CompletionOptions, CompletionItemFeature, CompletionMiddleware } from './completion'
import { $ConfigurationOptions, ConfigurationMiddleware, DidChangeConfigurationMiddleware, PullConfigurationFeature, SyncConfigurationFeature } from './configuration'
import { DeclarationFeature, DeclarationMiddleware } from './declaration'
import { DefinitionFeature, DefinitionMiddleware } from './definition'
import { $DiagnosticPullOptions, DiagnosticFeature, DiagnosticProviderMiddleware, DiagnosticProviderShape } from './diagnostic'
import { DocumentHighlightFeature, DocumentHighlightMiddleware } from './documentHighlight'
import { DocumentLinkFeature, DocumentLinkMiddleware } from './documentLink'
import { DocumentSymbolFeature, DocumentSymbolMiddleware } from './documentSymbol'
import { ExecuteCommandFeature, ExecuteCommandMiddleware } from './executeCommand'
import { Connection, DynamicFeature, ensure, FeatureClient, LSPCancellationError, RegistrationData, StaticFeature, TextDocumentProviderFeature, TextDocumentSendFeature } from './features'
import { DidCreateFilesFeature, DidDeleteFilesFeature, DidRenameFilesFeature, FileOperationsMiddleware, WillCreateFilesFeature, WillDeleteFilesFeature, WillRenameFilesFeature } from './fileOperations'
import { FileSystemWatcherFeature, FileSystemWatcherMiddleware } from './fileSystemWatcher'
import { FoldingRangeFeature, FoldingRangeProviderMiddleware } from './foldingRange'
import { $FormattingOptions, DocumentFormattingFeature, DocumentOnTypeFormattingFeature, DocumentRangeFormattingFeature, FormattingMiddleware } from './formatting'
import { HoverFeature, HoverMiddleware } from './hover'
import { ImplementationFeature, ImplementationMiddleware } from './implementation'
import { InlayHintsFeature, InlayHintsMiddleware, InlayHintsProviderShape } from './inlayHint'
import { InlineValueFeature, InlineValueMiddleware, InlineValueProviderShape } from './inlineValue'
import { LinkedEditingFeature, LinkedEditingRangeMiddleware } from './linkedEditingRange'
import { ProgressFeature } from './progress'
import { ProgressPart } from './progressPart'
import { ReferencesFeature, ReferencesMiddleware } from './reference'
import { RenameFeature, RenameMiddleware } from './rename'
import { SelectionRangeFeature, SelectionRangeProviderMiddleware } from './selectionRange'
import { SemanticTokensFeature, SemanticTokensMiddleware, SemanticTokensProviderShape } from './semanticTokens'
import { SignatureHelpFeature, SignatureHelpMiddleware } from './signatureHelp'
import { DidChangeTextDocumentFeature, DidChangeTextDocumentFeatureShape, DidCloseTextDocumentFeature, DidCloseTextDocumentFeatureShape, DidOpenTextDocumentFeature, DidOpenTextDocumentFeatureShape, DidSaveTextDocumentFeature, DidSaveTextDocumentFeatureShape, ResolvedTextDocumentSyncCapabilities, TextDocumentSynchronizationMiddleware, WillSaveFeature, WillSaveWaitUntilFeature } from './textSynchronization'
import { TypeDefinitionFeature, TypeDefinitionMiddleware } from './typeDefinition'
import { TypeHierarchyFeature, TypeHierarchyMiddleware } from './typeHierarchy'
import { currentTimeStamp, data2String, getLocale, getTraceMessage, parseTraceData, toMethod } from './utils'
import * as cv from './utils/converter'
import { CloseAction, DefaultErrorHandler, ErrorAction, ErrorHandler, InitializationFailedHandler } from './utils/errorHandler'
import { ConsoleLogger, NullLogger } from './utils/logger'
import * as UUID from './utils/uuid'
import { $WorkspaceOptions, WorkspaceFolderMiddleware, WorkspaceFoldersFeature } from './workspaceFolders'
import { WorkspaceProviderFeature, WorkspaceSymbolFeature, WorkspaceSymbolMiddleware } from './workspaceSymbol'

const logger = createLogger('language-client-client')

export { ErrorAction, CloseAction, NullLogger }

interface ConnectionErrorHandler {
  (error: Error, message: Message | undefined, count: number | undefined): void
}

interface ConnectionCloseHandler {
  (): void
}

interface ConnectionOptions {
  cancellationStrategy?: CancellationStrategy
  connectionStrategy?: ConnectionStrategy
  maxRestartCount?: number
}

const redOpen = '\x1B[31m'
const redClose = '\x1B[39m'

function createConnection(input: MessageReader, output: MessageWriter, errorHandler: ConnectionErrorHandler, closeHandler: ConnectionCloseHandler, options?: ConnectionOptions): Connection {
  let logger = new ConsoleLogger()
  let connection = createProtocolConnection(input, output, logger, options)
  // let disposables: Disposable[] = []
  connection.onError(data => { errorHandler(data[0], data[1], data[2]) })
  connection.onClose(closeHandler)
  let result: Connection = {
    id: '',
    hasPendingResponse: (): boolean => connection.hasPendingResponse(),
    listen: (): void => connection.listen(),
    sendRequest: <R>(type: string | MessageSignature, ...params: any[]): Promise<R> => {
      return connection.sendRequest(toMethod(type), ...params)
    },
    onRequest: <R, E>(type: string | MessageSignature, handler: GenericRequestHandler<R, E>): Disposable => connection.onRequest(toMethod(type), handler),
    sendNotification: (type: string | MessageSignature, params?: any): Promise<void> => {
      return connection.sendNotification(toMethod(type), params)
    },
    onNotification: (type: string | MessageSignature, handler: GenericNotificationHandler): Disposable => connection.onNotification(toMethod(type), handler),

    onProgress: connection.onProgress,
    sendProgress: connection.sendProgress,
    trace: (
      value: Trace,
      tracer: Tracer,
      sendNotificationOrTraceOptions: TraceOptions
    ): Promise<void> => {
      return connection.trace(value, tracer, sendNotificationOrTraceOptions)
    },
    initialize: (params: InitializeParams) => {
      return connection.sendRequest(InitializeRequest.type, params)
    },
    shutdown: () => {
      return connection.sendRequest(ShutdownRequest.type, undefined)
    },
    exit: () => {
      return connection.sendNotification(ExitNotification.type)
    },
    end: () => connection.end(),
    dispose: () => connection.dispose()
  }
  return result
}

export enum RevealOutputChannelOn {
  Info = 1,
  Warn = 2,
  Error = 3,
  Never = 4
}

export interface HandleWorkDoneProgressSignature {
  (this: void, token: ProgressToken, params: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd): void
}

export interface HandleDiagnosticsSignature {
  (this: void, uri: string, diagnostics: Diagnostic[]): void
}

export type WorkspaceMiddleware = DidChangeConfigurationMiddleware & FileSystemWatcherMiddleware & ConfigurationMiddleware & WorkspaceFolderMiddleware & FileOperationsMiddleware

export interface _WindowMiddleware {
  showDocument?: (this: void, params: ShowDocumentParams, next: ShowDocumentRequest.HandlerSignature) => Promise<ShowDocumentResult>
}

/**
 * The Middleware lets extensions intercept the request and notifications send and received
 * from the server
 */
export interface _Middleware {
  handleDiagnostics?: (this: void, uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => void
  handleWorkDoneProgress?: (this: void, token: ProgressToken, params: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd, next: HandleWorkDoneProgressSignature) => void
  workspace?: WorkspaceMiddleware
  window?: _WindowMiddleware
}

export type Middleware = _Middleware & TextDocumentSynchronizationMiddleware & SignatureHelpMiddleware & ReferencesMiddleware &
  DefinitionMiddleware & DocumentHighlightMiddleware & DocumentSymbolMiddleware & DocumentLinkMiddleware &
  CodeActionMiddleware & FormattingMiddleware & RenameMiddleware & CodeLensMiddleware &
  HoverMiddleware & CompletionMiddleware & ExecuteCommandMiddleware & TypeDefinitionMiddleware &
  ImplementationMiddleware & ColorProviderMiddleware & DeclarationMiddleware &
  FoldingRangeProviderMiddleware & CallHierarchyMiddleware & SemanticTokensMiddleware &
  InlayHintsMiddleware & InlineValueMiddleware & TypeHierarchyMiddleware &
  WorkspaceSymbolMiddleware & DiagnosticProviderMiddleware & LinkedEditingRangeMiddleware &
  SelectionRangeProviderMiddleware

export type LanguageClientOptions = {
  rootPatterns?: string[]
  requireRootPattern?: boolean
  documentSelector?: DocumentSelector
  separateDiagnostics?: boolean
  disableMarkdown?: boolean
  disableWorkspaceFolders?: boolean
  disableDiagnostics?: boolean
  disableCompletion?: boolean
  diagnosticCollectionName?: string
  disableDynamicRegister?: boolean
  disabledFeatures?: string[]
  outputChannelName?: string
  outputChannel?: OutputChannel
  revealOutputChannelOn?: RevealOutputChannelOn
  /**
   * The encoding use to read stdout and stderr. Defaults
   * to 'utf8' if omitted.
   */
  stdioEncoding?: string
  initializationOptions?: any | (() => any)
  initializationFailedHandler?: InitializationFailedHandler
  progressOnInitialization?: boolean
  errorHandler?: ErrorHandler
  middleware?: Middleware
  connectionOptions?: ConnectionOptions
  markdown?: {
    isTrusted?: boolean
    supportHtml?: boolean
  }
} & $ConfigurationOptions & $CompletionOptions & $FormattingOptions & $DiagnosticPullOptions & $WorkspaceOptions

type ResolvedClientOptions = {
  disabledFeatures: string[]
  disableMarkdown: boolean
  disableDynamicRegister: boolean
  separateDiagnostics: boolean
  rootPatterns?: string[]
  requireRootPattern?: boolean
  documentSelector: DocumentSelector
  diagnosticCollectionName?: string
  outputChannelName: string
  revealOutputChannelOn: RevealOutputChannelOn
  stdioEncoding: string
  initializationOptions?: any | (() => any)
  initializationFailedHandler?: InitializationFailedHandler
  progressOnInitialization: boolean
  errorHandler: ErrorHandler
  middleware: Middleware
  connectionOptions?: ConnectionOptions
  markdown: {
    isTrusted: boolean
    supportHtml?: boolean
  }
} & $ConfigurationOptions & Required<$CompletionOptions> & Required<$FormattingOptions> & Required<$DiagnosticPullOptions> & Required<$WorkspaceOptions>

export enum State {
  Stopped = 1,
  Running = 2,
  Starting = 3,
}

export interface StateChangeEvent {
  oldState: State
  newState: State
}

export enum ClientState {
  Initial,
  Starting,
  StartFailed,
  Running,
  Stopping,
  Stopped
}

export interface MessageTransports {
  reader: MessageReader
  writer: MessageWriter
  detached?: boolean
}

// eslint-disable-next-line no-redeclare
export namespace MessageTransports {
  export function is(value: any): value is MessageTransports {
    let candidate: MessageTransports = value
    return (
      candidate &&
      MessageReader.is(value.reader) &&
      MessageWriter.is(value.writer)
    )
  }
}

export abstract class BaseLanguageClient implements FeatureClient<Middleware, LanguageClientOptions> {
  private _id: string
  private _name: string
  private _clientOptions: ResolvedClientOptions
  private _rootPath: string | false
  private _disposed: 'disposing' | 'disposed' | undefined
  private readonly _ignoredRegistrations: Set<string>

  protected _state: ClientState
  private _onStart: Promise<void> | undefined
  private _onStop: Promise<void> | undefined
  public _connection: Connection | undefined
  private _initializeResult: InitializeResult | undefined
  private _outputChannel: OutputChannel | undefined
  private _capabilities: ServerCapabilities & ResolvedTextDocumentSyncCapabilities

  private readonly _notificationHandlers: Map<string, GenericNotificationHandler>
  private readonly _notificationDisposables: Map<string, Disposable>
  private readonly _pendingNotificationHandlers: Map<string, GenericNotificationHandler>
  private readonly _requestHandlers: Map<string, GenericRequestHandler<unknown, unknown>>
  private readonly _requestDisposables: Map<string, Disposable>
  private readonly _pendingRequestHandlers: Map<string, GenericRequestHandler<unknown, unknown>>
  private readonly _progressHandlers: Map<string | number, { type: ProgressType<any>; handler: NotificationHandler<any> }>
  private readonly _pendingProgressHandlers: Map<string | number, { type: ProgressType<any>; handler: NotificationHandler<any> }>
  private readonly _progressDisposables: Map<string | number, Disposable>

  private _listeners: Disposable[]
  private _diagnostics: DiagnosticCollection | undefined
  private _syncedDocuments: Map<string, TextDocument>
  private _stateChangeEmitter: Emitter<StateChangeEvent>

  private _traceFormat: TraceFormat
  private _trace: Trace
  private _tracer: Tracer
  private _consoleDebug = false

  public constructor(
    id: string,
    name: string,
    clientOptions: LanguageClientOptions
  ) {
    this._id = id
    this._name = name
    if (clientOptions.outputChannel) {
      this._outputChannel = clientOptions.outputChannel
    } else {
      this._outputChannel = undefined
    }
    this._clientOptions = this.resolveClientOptions(clientOptions)
    this.$state = ClientState.Initial
    this._connection = undefined
    this._initializeResult = undefined
    this._listeners = []
    this._diagnostics = undefined

    this._notificationHandlers = new Map()
    this._pendingNotificationHandlers = new Map()
    this._notificationDisposables = new Map()
    this._requestHandlers = new Map()
    this._pendingRequestHandlers = new Map()
    this._requestDisposables = new Map()
    this._progressHandlers = new Map()
    this._pendingProgressHandlers = new Map()
    this._progressDisposables = new Map()

    this._ignoredRegistrations = new Set()
    this._onStop = undefined
    this._stateChangeEmitter = new Emitter<StateChangeEvent>()
    this._trace = Trace.Off
    this._tracer = {
      log: (messageOrDataObject: string | any, data?: string) => {
        if (Is.string(messageOrDataObject)) {
          this.logTrace(messageOrDataObject, data)
        } else {
          this.logObjectTrace(messageOrDataObject)
        }
      }
    }
    this._syncedDocuments = new Map<string, TextDocument>()
    this.registerBuiltinFeatures()
  }

  public switchConsole(): void {
    this._consoleDebug = !this._consoleDebug
    if (!this._consoleDebug) {
      this.enableVerboseTrace()
    }
  }

  private resolveClientOptions(clientOptions: LanguageClientOptions): ResolvedClientOptions {
    const markdown = { isTrusted: false, supportHtml: false }
    if (clientOptions.markdown != null) {
      markdown.isTrusted = clientOptions.markdown.isTrusted === true
      markdown.supportHtml = clientOptions.markdown.supportHtml === true
    }
    let disableSnippetCompletion = clientOptions.disableSnippetCompletion
    let disableMarkdown = clientOptions.disableMarkdown
    if (disableMarkdown === undefined) {
      disableMarkdown = workspace.initialConfiguration.get<boolean>('coc.preferences.enableMarkdown') === false
    }
    const pullConfig = workspace.getConfiguration('pullDiagnostic', clientOptions.workspaceFolder)
    let pullOption = clientOptions.diagnosticPullOptions ?? {}
    if (pullOption.onChange === undefined) pullOption.onChange = pullConfig.get<boolean>('onChange')
    if (pullOption.onSave === undefined) pullOption.onSave = pullConfig.get<boolean>('onSave')
    if (pullOption.workspace === undefined) pullOption.workspace = pullConfig.get<boolean>('workspace')
    pullOption.ignored = pullConfig.get<string[]>('ignored', []).concat(pullOption.ignored ?? [])

    let disabledFeatures = clientOptions.disabledFeatures ?? []
    for (let key of ['disableCompletion', 'disableWorkspaceFolders', 'disableDiagnostics']) {
      if (typeof clientOptions[key] === 'boolean') {
        let stack = '\n' + Error().stack.split('\n').slice(2, 4).join('\n')
        logger.warn(`${key} in the client options is deprecated. use disabledFeatures instead.`, stack)
        if (clientOptions[key] === true) {
          let s = key.slice(7)
          disabledFeatures.push(s[0].toLowerCase() + s.slice(1))
        }
      }
    }
    let separateDiagnostics = clientOptions.separateDiagnostics
    if (clientOptions.separateDiagnostics === undefined) {
      separateDiagnostics = workspace.getConfiguration('diagnostic', clientOptions.workspaceFolder).get('separateRelatedInformationAsDiagnostics') as boolean
    }
    return {
      disabledFeatures,
      disableMarkdown,
      disableSnippetCompletion,
      separateDiagnostics,
      diagnosticPullOptions: pullOption,
      rootPatterns: clientOptions.rootPatterns ?? [],
      requireRootPattern: clientOptions.requireRootPattern,
      disableDynamicRegister: clientOptions.disableDynamicRegister,
      formatterPriority: clientOptions.formatterPriority ?? 0,
      ignoredRootPaths: clientOptions.ignoredRootPaths ?? [],
      documentSelector: clientOptions.documentSelector ?? [],
      synchronize: clientOptions.synchronize ?? {},
      diagnosticCollectionName: clientOptions.diagnosticCollectionName,
      outputChannelName: clientOptions.outputChannelName ?? this._id,
      revealOutputChannelOn: clientOptions.revealOutputChannelOn ?? RevealOutputChannelOn.Never,
      stdioEncoding: clientOptions.stdioEncoding ?? 'utf8',
      initializationOptions: clientOptions.initializationOptions,
      initializationFailedHandler: clientOptions.initializationFailedHandler,
      progressOnInitialization: clientOptions.progressOnInitialization === true,
      errorHandler: clientOptions.errorHandler ?? this.createDefaultErrorHandler(clientOptions.connectionOptions?.maxRestartCount),
      middleware: clientOptions.middleware ?? {},
      workspaceFolder: clientOptions.workspaceFolder,
      connectionOptions: clientOptions.connectionOptions,
      markdown
    }
  }

  public get supportedMarkupKind(): MarkupKind[] {
    if (!this.clientOptions.disableMarkdown) return [MarkupKind.Markdown, MarkupKind.PlainText]
    return [MarkupKind.PlainText]
  }

  public get state(): State {
    return this.getPublicState()
  }

  private get $state(): ClientState {
    return this._state
  }

  private set $state(value: ClientState) {
    let oldState = this.getPublicState()
    this._state = value
    let newState = this.getPublicState()
    if (newState !== oldState) {
      this._stateChangeEmitter.fire({ oldState, newState })
    }
  }

  public get id(): string {
    return this._id
  }

  public get name(): string {
    return this._name
  }

  public get middleware(): Middleware {
    return this._clientOptions.middleware
  }

  public getPublicState(): State {
    if (this.$state === ClientState.Running) {
      return State.Running
    } else if (this.$state === ClientState.Starting) {
      return State.Starting
    } else {
      return State.Stopped
    }
  }

  public get initializeResult(): InitializeResult | undefined {
    return this._initializeResult
  }

  public sendRequest<R, PR, E, RO>(type: ProtocolRequestType0<R, PR, E, RO>, token?: CancellationToken): Promise<R>
  public sendRequest<P, R, PR, E, RO>(type: ProtocolRequestType<P, R, PR, E, RO>, params: P, token?: CancellationToken): Promise<R>
  public sendRequest<R, E>(type: RequestType0<R, E>, token?: CancellationToken): Promise<R>
  public sendRequest<P, R, E>(type: RequestType<P, R, E>, params: P, token?: CancellationToken): Promise<R>
  public sendRequest<R>(method: string, token?: CancellationToken): Promise<R>
  public sendRequest<R>(method: string, param: any, token?: CancellationToken): Promise<R>
  public async sendRequest<R>(type: string | MessageSignature, ...params: any[]): Promise<R> {
    this.checkState()
    try {
      const connection = await this.$start()
      return await connection.sendRequest<R>(type, ...params)
    } catch (error) {
      this.error(`Sending request ${toMethod(type)} failed.`, error)
      throw error
    }
  }

  public onRequest<R, PR, E, RO>(type: ProtocolRequestType0<R, PR, E, RO>, handler: RequestHandler0<R, E>): Disposable
  public onRequest<P, R, PR, E, RO>(type: ProtocolRequestType<P, R, PR, E, RO>, handler: RequestHandler<P, R, E>): Disposable
  public onRequest<R, E>(type: RequestType0<R, E>, handler: RequestHandler0<R, E>): Disposable
  public onRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>): Disposable
  public onRequest<R, E>(method: string, handler: GenericRequestHandler<R, E>): Disposable
  public onRequest<R, E>(type: string | MessageSignature, handler: GenericRequestHandler<R, E>): Disposable {
    const method = toMethod(type)
    this._requestHandlers.set(method, handler)
    const connection = this.activeConnection()
    let disposable: Disposable
    if (connection !== undefined) {
      this._requestDisposables.set(method, connection.onRequest(type, handler))
      disposable = {
        dispose: () => {
          const disposable = this._requestDisposables.get(method)
          if (disposable !== undefined) {
            disposable.dispose()
            this._requestDisposables.delete(method)
          }
        }
      }
    } else {
      this._pendingRequestHandlers.set(method, handler)
      disposable = {
        dispose: () => {
          this._pendingRequestHandlers.delete(method)
          const disposable = this._requestDisposables.get(method)
          if (disposable !== undefined) {
            disposable.dispose()
            this._requestDisposables.delete(method)
          }
        }
      }
    }
    return {
      dispose: () => {
        this._requestHandlers.delete(method)
        disposable.dispose()
      }
    }
  }

  public sendNotification<RO>(type: ProtocolNotificationType0<RO>): Promise<void>
  public sendNotification<P, RO>(type: ProtocolNotificationType<P, RO>, params?: P): Promise<void>
  public sendNotification(type: NotificationType0): Promise<void>
  public sendNotification<P>(type: NotificationType<P>, params?: P): Promise<void>
  public sendNotification(method: string, params?: any): Promise<void>
  public async sendNotification<P>(type: string | MessageSignature, params?: P): Promise<void> {
    if (this.$state === ClientState.StartFailed || this.$state === ClientState.Stopping || this.$state === ClientState.Stopped) {
      // not throw for notification
      return
    }
    try {
      const connection = await this.$start()
      return await connection.sendNotification(type, params)
    } catch (error) {
      this.error(`Sending notification ${toMethod(type)} failed.`, error)
      throw error
    }
  }

  public onNotification<RO>(type: ProtocolNotificationType0<RO>, handler: NotificationHandler0): Disposable
  public onNotification<P, RO>(type: ProtocolNotificationType<P, RO>, handler: NotificationHandler<P>): Disposable
  public onNotification(type: NotificationType0, handler: NotificationHandler0): Disposable
  public onNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>): Disposable
  public onNotification(method: string, handler: GenericNotificationHandler): Disposable
  public onNotification(type: string | MessageSignature, handler: GenericNotificationHandler): Disposable {
    const method = toMethod(type)
    this._notificationHandlers.set(method, handler)
    const connection = this.activeConnection()
    let disposable: Disposable
    if (connection !== undefined) {
      this._notificationDisposables.set(method, connection.onNotification(type, handler))
      disposable = {
        dispose: () => {
          const disposable = this._notificationDisposables.get(method)
          if (disposable !== undefined) {
            disposable.dispose()
            this._notificationDisposables.delete(method)
          }
        }
      }
    } else {
      this._pendingNotificationHandlers.set(method, handler)
      disposable = {
        dispose: () => {
          this._pendingNotificationHandlers.delete(method)
          const disposable = this._notificationDisposables.get(method)
          if (disposable !== undefined) {
            disposable.dispose()
            this._notificationDisposables.delete(method)
          }
        }
      }
    }
    return {
      dispose: () => {
        this._notificationHandlers.delete(method)
        disposable.dispose()
      }
    }
  }

  public onProgress<P>(type: ProgressType<any>, token: string | number, handler: NotificationHandler<P>): Disposable {
    this._progressHandlers.set(token, { type, handler })
    const connection = this.activeConnection()
    let disposable: Disposable
    const handleWorkDoneProgress = this._clientOptions.middleware.handleWorkDoneProgress
    const realHandler = WorkDoneProgress.is(type) && handleWorkDoneProgress !== undefined
      ? (params: P) => {
        handleWorkDoneProgress(token, params as any, () => handler(params as unknown as P))
      }
      : handler
    if (connection !== undefined) {
      this._progressDisposables.set(token, connection.onProgress(type, token, realHandler))
      disposable = {
        dispose: () => {
          const disposable = this._progressDisposables.get(token)
          if (disposable !== undefined) {
            disposable.dispose()
            this._progressDisposables.delete(token)
          }
        }
      }
    } else {
      this._pendingProgressHandlers.set(token, { type, handler })
      disposable = {
        dispose: () => {
          this._pendingProgressHandlers.delete(token)
          const disposable = this._progressDisposables.get(token)
          if (disposable !== undefined) {
            disposable.dispose()
            this._progressDisposables.delete(token)
          }
        }
      }
    }
    return {
      dispose: (): void => {
        this._progressHandlers.delete(token)
        disposable.dispose()
      }
    }
  }

  public async sendProgress<P>(type: ProgressType<P>, token: string | number, value: P): Promise<void> {
    this.checkState()
    try {
      const connection = await this.$start()
      await connection.sendProgress(type, token, value)
    } catch (error) {
      this.error(`Sending progress for token ${token} failed.`, error)
      throw error
    }
  }

  /**
   * languageserver.xxx.settings or undefined
   */
  public get configuredSection(): string | undefined {
    let section = this._clientOptions.synchronize?.configurationSection
    return typeof section === 'string' && section.startsWith('languageserver.') ? section : undefined
  }

  public get clientOptions(): LanguageClientOptions {
    return this._clientOptions
  }

  public get onDidChangeState(): Event<StateChangeEvent> {
    return this._stateChangeEmitter.event
  }

  public get outputChannel(): OutputChannel {
    if (!this._outputChannel) {
      let { outputChannelName } = this._clientOptions
      this._outputChannel = window.createOutputChannel(defaultValue(outputChannelName, this._name))
    }
    return this._outputChannel
  }

  public get diagnostics(): DiagnosticCollection | undefined {
    return this._diagnostics
  }

  public createDefaultErrorHandler(maxRestartCount?: number): ErrorHandler {
    return new DefaultErrorHandler(this._id, maxRestartCount ?? 4)
  }

  public set trace(value: Trace) {
    this._trace = value
    const connection = this.activeConnection()
    if (connection !== undefined) {
      void connection.trace(this._trace, this._tracer, {
        sendNotification: false,
        traceFormat: this._traceFormat
      })
    }
  }

  private logObjectTrace(data: any): void {
    this.outputChannel.append(getTraceMessage(data))
    this.traceData(data)
  }

  private traceData(data: any, error = false): void {
    this.outputChannel.appendLine(data2String(data))
    if (this._consoleDebug) error ? console.error(redOpen + data2String(data) + redClose) : console.log(parseTraceData(data))
  }

  private consoleMessage(prefix: string, message: string, error = false): void {
    if (this._consoleDebug) {
      let msg = prefix + ' ' + message
      error ? console.error(redOpen + msg + redClose) : console.log(msg)
    }
  }

  public info(message: string, data?: any, showNotification = true): void {
    let prefix = `[Info  - ${currentTimeStamp()}]`
    this.outputChannel.appendLine(`${prefix} ${message}`)
    this.consoleMessage(prefix, message)
    if (data != null) this.traceData(data)
    if (showNotification && this._clientOptions.revealOutputChannelOn <= RevealOutputChannelOn.Info) {
      this.showNotificationMessage(MessageType.Info, message)
    }
  }

  public warn(message: string, data?: any, showNotification = true): void {
    let prefix = `[Warn  - ${currentTimeStamp()}]`
    this.outputChannel.appendLine(`${prefix} ${message}`)
    this.consoleMessage(prefix, message)
    if (data != null) this.traceData(data)
    if (showNotification && this._clientOptions.revealOutputChannelOn <= RevealOutputChannelOn.Warn) {
      this.showNotificationMessage(MessageType.Warning, message)
    }
  }

  public error(message: string, data?: any, showNotification: boolean | 'force' = true): void {
    let prefix = `[Error - ${currentTimeStamp()}]`
    this.outputChannel.appendLine(`${prefix} ${message}`)
    this.consoleMessage(prefix, message, true)
    if (data != null) this.traceData(data, true)
    if (showNotification === 'force' || (showNotification && this._clientOptions.revealOutputChannelOn <= RevealOutputChannelOn.Error)) {
      this.showNotificationMessage(MessageType.Error, message)
    }
  }

  private logTrace(message: string, data?: any): void {
    let prefix = `[Trace - ${currentTimeStamp()}]`
    this.outputChannel.appendLine(`${prefix} ${message}`)
    this.consoleMessage(prefix, message)
    if (data != null) this.traceData(data)
  }

  private showNotificationMessage(type: MessageType, message: string) {
    const messageFunc = type === MessageType.Error
      ? window.showErrorMessage.bind(window)
      : type === MessageType.Warning
        ? window.showWarningMessage.bind(window)
        : window.showInformationMessage.bind(window)
    void messageFunc(message)
  }

  public needsStart(): boolean {
    return (
      this.$state === ClientState.Initial ||
      this.$state === ClientState.Stopping ||
      this.$state === ClientState.Stopped
    )
  }

  public needsStop(): boolean {
    return (
      this.$state === ClientState.Starting || this.$state === ClientState.Running
    )
  }

  private activeConnection(): Connection | undefined {
    return this.$state === ClientState.Running && this._connection !== undefined ? this._connection : undefined
  }

  public get hasPendingResponse(): boolean {
    return this._connection?.hasPendingResponse()
  }

  public onReady(): Promise<void> {
    if (this._onStart) return this._onStart
    return new Promise(resolve => {
      let disposable = this.onDidChangeState(e => {
        if (e.newState === State.Running) {
          disposable.dispose()
          resolve()
        }
      })
    })
  }

  public get started(): boolean {
    return this.$state != ClientState.Initial
  }

  public isRunning(): boolean {
    return this.$state === ClientState.Running
  }

  public async _start(): Promise<void> {
    if (this._disposed === 'disposing' || this._disposed === 'disposed') {
      throw new Error(`Client got disposed and can't be restarted.`)
    }
    if (this.$state === ClientState.Stopping) {
      throw new Error(`Client is currently stopping. Can only restart a full stopped client`)
    }
    // We are already running or are in the process of getting up
    // to speed.
    if (this._onStart !== undefined) {
      return this._onStart
    }
    this._rootPath = this.resolveRootPath()

    const [promise, resolve, reject] = this.createOnStartPromise()
    this._onStart = promise

    // If we restart then the diagnostics collection is reused.
    if (this._diagnostics === undefined) {
      let opts = this._clientOptions
      let name = opts.diagnosticCollectionName ? opts.diagnosticCollectionName : this._id
      if (!opts.disabledFeatures.includes('diagnostics')) {
        this._diagnostics = languages.createDiagnosticCollection(name)
      }
    }

    // When we start make all buffer handlers pending so that they
    // get added.
    for (const [method, handler] of this._notificationHandlers) {
      if (!this._pendingNotificationHandlers.has(method)) {
        this._pendingNotificationHandlers.set(method, handler)
      }
    }
    for (const [method, handler] of this._requestHandlers) {
      if (!this._pendingRequestHandlers.has(method)) {
        this._pendingRequestHandlers.set(method, handler)
      }
    }
    for (const [token, data] of this._progressHandlers) {
      if (!this._pendingProgressHandlers.has(token)) {
        this._pendingProgressHandlers.set(token, data)
      }
    }

    this.$state = ClientState.Starting
    try {
      const connection = await this.createConnection()
      this.handleConnectionEvents(connection)
      connection.listen()
      await this.initialize(connection)
      resolve()
    } catch (error) {
      this.$state = ClientState.StartFailed
      this.error(`${this._name} client: couldn't create connection to server.`, error, 'force')
      reject(error)
    }
    return this._onStart
  }

  public start(): Promise<void> & Disposable {
    let p: any = this._start()
    p.dispose = () => {
      if (this.needsStop()) {
        void this.stop()
      }
    }
    return p
  }

  private async $start(): Promise<Connection> {
    if (this.$state === ClientState.StartFailed) {
      throw new Error(`Previous start failed. Can't restart server.`)
    }
    await this._start()
    const connection = this.activeConnection()
    if (connection === undefined) {
      throw new Error(`Starting server failed`)
    }
    return connection
  }

  private handleConnectionEvents(connection: Connection) {
    connection.onNotification(LogMessageNotification.type, message => {
      switch (message.type) {
        case MessageType.Error:
          this.error(message.message)
          break
        case MessageType.Warning:
          this.warn(message.message)
          break
        case MessageType.Info:
          this.info(message.message)
          break
        default:
          this.outputChannel.appendLine(message.message)
      }
    })
    connection.onNotification(ShowMessageNotification.type, message => {
      switch (message.type) {
        case MessageType.Error:
          void window.showErrorMessage(message.message)
          break
        case MessageType.Warning:
          void window.showWarningMessage(message.message)
          break
        case MessageType.Info:
          void window.showInformationMessage(message.message)
          break
        default:
          void window.showInformationMessage(message.message)
      }
    })
    // connection.onNotification(TelemetryEventNotification.type, data => {
    //   // Not supported.
    //   // this._telemetryEmitter.fire(data);
    // })
    connection.onRequest(ShowMessageRequest.type, (params: ShowMessageRequestParams) => {
      let messageFunc: <T extends MessageItem>(message: string, ...items: T[]) => Thenable<T>
      switch (params.type) {
        case MessageType.Error:
          messageFunc = window.showErrorMessage.bind(window)
          break
        case MessageType.Warning:
          messageFunc = window.showWarningMessage.bind(window)
          break
        case MessageType.Info:
          messageFunc = window.showInformationMessage.bind(window)
          break
        default:
          messageFunc = window.showInformationMessage.bind(window)
      }
      let actions: MessageActionItem[] = toArray(params.actions)
      return messageFunc(params.message, ...actions).then(res => {
        return res == null ? null : res
      })
    })
    connection.onRequest(ShowDocumentRequest.type, async (params): Promise<ShowDocumentResult> => {
      const showDocument = async (params: ShowDocumentParams): Promise<ShowDocumentResult> => {
        try {
          if (params.external === true || /^https?:\/\//.test(params.uri)) {
            await workspace.openResource(params.uri)
            return { success: true }
          } else {
            let { selection, takeFocus } = params
            if (takeFocus === false) {
              await workspace.loadFile(params.uri)
            } else {
              await workspace.jumpTo(params.uri, selection?.start)
              if (selection && comparePosition(selection.start, selection.end) != 0) {
                await window.selectRange(selection)
              }
            }
            return { success: true }
          }
        } catch (error) {
          return { success: false }
        }
      }
      const middleware = this._clientOptions.middleware.window?.showDocument
      if (middleware !== undefined) {
        return middleware(params, showDocument)
      } else {
        return showDocument(params)
      }
    })
  }

  private createOnStartPromise(): [Promise<void>, () => void, (error: any) => void] {
    let resolve!: () => void
    let reject!: (error: any) => void
    const promise: Promise<void> = new Promise((_resolve, _reject) => {
      resolve = _resolve
      reject = _reject
    })
    return [promise, resolve, reject]
  }

  private resolveRootPath(): string | null {
    if (this._clientOptions.workspaceFolder) {
      return URI.parse(this._clientOptions.workspaceFolder.uri).fsPath
    }
    let { ignoredRootPaths, rootPatterns, requireRootPattern } = this._clientOptions
    let resolved: string | undefined
    if (!isFalsyOrEmpty(rootPatterns)) {
      resolved = workspace.documentsManager.resolveRoot(rootPatterns, requireRootPattern)
    }
    let rootPath = resolved || workspace.rootPath
    if (sameFile(rootPath, os.homedir()) || ignoredRootPaths.some(p => sameFile(rootPath, p))) {
      this.warn(`Ignored rootPath ${rootPath} of client "${this._id}"`)
      return null
    }
    return rootPath
  }

  private initialize(connection: Connection): Promise<InitializeResult> {
    let { initializationOptions, workspaceFolder, progressOnInitialization } = this._clientOptions
    this.refreshTrace(connection, false)
    let rootPath = this._rootPath
    let initParams: InitializeParams = {
      processId: process.pid,
      rootPath: rootPath ? rootPath : null,
      rootUri: rootPath ? cv.asUri(URI.file(rootPath)) : null,
      capabilities: this.computeClientCapabilities(),
      initializationOptions: Is.func(initializationOptions) ? initializationOptions() : initializationOptions,
      trace: Trace.toString(this._trace),
      workspaceFolders: workspaceFolder ? [workspaceFolder] : null,
      locale: getLocale(),
      clientInfo: {
        name: 'coc.nvim',
        version: workspace.version
      }
    }
    this.fillInitializeParams(initParams)
    if (progressOnInitialization) {
      const token: ProgressToken = UUID.generateUuid()
      initParams.workDoneToken = token
      connection.id = this._id
      const part = new ProgressPart(connection, token)
      part.begin({ title: `Initializing ${this.id}`, kind: 'begin' })
      return this.doInitialize(connection, initParams).then(result => {
        part.done()
        return result
      }, error => {
        part.done()
        return Promise.reject(error)
      })
    } else {
      return this.doInitialize(connection, initParams)
    }
  }

  private async doInitialize(connection: Connection, initParams: InitializeParams): Promise<InitializeResult> {
    try {
      const result = await connection.initialize(initParams)
      if (result.capabilities.positionEncoding !== undefined && result.capabilities.positionEncoding !== PositionEncodingKind.UTF16) {
        await connection.shutdown()
        await connection.exit()
        connection.end()
        connection.dispose()
        throw new Error(`Unsupported position encoding (${result.capabilities.positionEncoding}) received from server ${this.name}`)
      }

      this._initializeResult = result
      this.$state = ClientState.Running
      let textDocumentSyncOptions: TextDocumentSyncOptions | undefined
      if (Is.number(result.capabilities.textDocumentSync)) {
        if (result.capabilities.textDocumentSync === TextDocumentSyncKind.None) {
          textDocumentSyncOptions = {
            openClose: false,
            change: TextDocumentSyncKind.None,
            save: undefined
          }
        } else {
          textDocumentSyncOptions = {
            openClose: true,
            change: result.capabilities.textDocumentSync,
            save: {
              includeText: false
            }
          }
        }
      } else if (result.capabilities.textDocumentSync !== undefined && result.capabilities.textDocumentSync !== null) {
        textDocumentSyncOptions = result.capabilities.textDocumentSync as TextDocumentSyncOptions
      }
      this._capabilities = Object.assign({}, result.capabilities, { resolvedTextDocumentSync: textDocumentSyncOptions })
      connection.onNotification(PublishDiagnosticsNotification.type, params => this.handleDiagnostics(params))
      connection.onRequest(RegistrationRequest.type, params => this.handleRegistrationRequest(params))
      // See https://github.com/Microsoft/vscode-languageserver-node/issues/199
      connection.onRequest('client/registerFeature', params => this.handleRegistrationRequest(params))
      connection.onRequest(UnregistrationRequest.type, params => this.handleUnregistrationRequest(params))
      // See https://github.com/Microsoft/vscode-languageserver-node/issues/199
      connection.onRequest('client/unregisterFeature', params => this.handleUnregistrationRequest(params))
      connection.onRequest(ApplyWorkspaceEditRequest.type, params => this.handleApplyWorkspaceEdit(params))

      // Add pending notification, request and progress handlers.
      for (const [method, handler] of this._pendingNotificationHandlers) {
        this._notificationDisposables.set(method, connection.onNotification(method, handler))
      }
      this._pendingNotificationHandlers.clear()
      for (const [method, handler] of this._pendingRequestHandlers) {
        this._requestDisposables.set(method, connection.onRequest(method, handler))
      }
      this._pendingRequestHandlers.clear()
      for (const [token, data] of this._pendingProgressHandlers) {
        this._progressDisposables.set(token, connection.onProgress(data.type, token, data.handler))
      }
      this._pendingProgressHandlers.clear()
      await connection.sendNotification(InitializedNotification.type, {})
      this.hookConfigurationChanged(connection)
      this.initializeFeatures(connection)
      return result
    } catch (error: any) {
      let cb = (retry: boolean) => {
        if (retry) {
          this.initialize(connection).catch(() => {})
        } else {
          this.stop().catch(() => {})
        }
      }
      if (this._clientOptions.initializationFailedHandler) {
        cb(this._clientOptions.initializationFailedHandler(error))
      } else if (error instanceof ResponseError && error.data && error.data.retry) {
        if (this._connection) {
          let connection = this._connection
          connection.end()
          this._connection.dispose()
          this._connection = null
        }
        void window.showErrorMessage(error.message, { title: 'Retry', id: 'retry' }).then(item => {
          cb(item && item.id === 'retry')
        })
      } else {
        void window.showErrorMessage(toText(error.message))
        this.error('Server initialization failed.', error)
        logger.error(`Server ${this.id} initialization failed.`, error)
        cb(false)
      }
      throw error
    }
  }

  public stop(timeout = 2000): Promise<void> {
    // Wait 2 seconds on stop
    return this.shutdown('stop', timeout)
  }

  private async shutdown(mode: 'suspend' | 'stop', timeout: number): Promise<void> {
    // If the client is stopped or in its initial state return.
    if (this.$state === ClientState.Stopped || this.$state === ClientState.Initial) {
      return
    }

    // If we are stopping the client and have a stop promise return it.
    if (this.$state === ClientState.Stopping) {
      return this._onStop
    }

    const connection = this.activeConnection()
    // We can't stop a client that is not running (e.g. has no connection). Especially not
    // on that us starting since it can't be correctly synchronized.
    if (connection === undefined || (this.$state !== ClientState.Running && this.$state !== ClientState.Starting)) {
      throw new Error(`Client is not running and can't be stopped. It's current state is: ${this.$state}`)
    }
    this._initializeResult = undefined
    this.$state = ClientState.Stopping
    this.cleanUp(mode)

    let tm: NodeJS.Timeout
    const tp = new Promise<undefined>(c => { tm = setTimeout(c, timeout) })
    const shutdown = (async connection => {
      await connection.shutdown()
      await connection.exit()
      return connection
    })(connection)

    return this._onStop = Promise.race([tp, shutdown]).then(connection => {
      if (tm) clearTimeout(tm)
      // The connection won the race with the timeout.
      if (connection !== undefined) {
        connection.end()
        connection.dispose()
      } else {
        this.error(`Stopping server timed out`, undefined)
        throw new Error(`Stopping the server timed out`)
      }
    }, error => {
      this.error(`Stopping server failed`, error)
      throw error
    }).finally(() => {
      this.$state = ClientState.Stopped
      mode === 'stop' && this.cleanUpChannel()
      this._onStart = undefined
      this._onStop = undefined
      this._connection = undefined
      this._ignoredRegistrations.clear()
    })
  }

  public dispose(timeout = 2000): Promise<void> {
    if (this._disposed) return
    try {
      this._disposed = 'disposing'
      if (!this.needsStop()) return
      return this.stop(timeout)
    } finally {
      this._disposed = 'disposed'
    }
  }

  private cleanUp(mode: 'restart' | 'suspend' | 'stop'): void {
    if (this._listeners) {
      this._listeners.forEach(listener => listener.dispose())
      this._listeners = []
    }
    if (this._syncedDocuments) {
      this._syncedDocuments.clear()
    }
    for (let feature of this._features.values()) {
      if (typeof feature.dispose === 'function') {
        feature.dispose()
      }
    }
    if (mode === 'stop' && this._diagnostics) {
      this._diagnostics.dispose()
      this._diagnostics = undefined
    }
  }

  private cleanUpChannel(): void {
    if (this._outputChannel) {
      this._outputChannel.dispose()
      this._outputChannel = undefined
    }
  }

  public async forceDocumentSync(): Promise<void> {
    let textDocuments = Array.from(this._syncedDocuments.values())
    await Promise.all(textDocuments.map(textDocument => {
      let doc = workspace.getDocument(textDocument.uri)
      return doc ? doc.synchronize() : null
    }))
  }

  private handleDiagnostics(params: PublishDiagnosticsParams) {
    let { uri, diagnostics, version } = params
    if (Is.number(version) && !workspace.hasDocument(uri, version)) return
    let middleware = this.clientOptions.middleware!.handleDiagnostics
    if (middleware) {
      middleware(uri, diagnostics, (uri, diagnostics) =>
        this.setDiagnostics(uri, diagnostics)
      )
    } else {
      this.setDiagnostics(uri, diagnostics)
    }
  }

  protected abstract createMessageTransports(
    encoding: string
  ): Promise<MessageTransports | null>

  private async createConnection(): Promise<Connection> {
    let errorHandler = (error: Error, message: Message | undefined, count: number | undefined) => {
      this.handleConnectionError(error, message, count)
    }
    let closeHandler = () => {
      this.handleConnectionClosed()
    }
    const transports = await this.createMessageTransports(defaultValue(this._clientOptions.stdioEncoding, 'utf8'))
    this._connection = createConnection(transports.reader, transports.writer, errorHandler, closeHandler, this._clientOptions.connectionOptions)
    return this._connection
  }

  protected handleConnectionClosed() {
    // Check whether this is a normal shutdown in progress or the client stopped normally.
    if (this.$state === ClientState.Stopped) {
      logger.debug(`client ${this._id} normal closed`)
      return
    }
    try {
      if (this._connection) {
        this._connection.dispose()
      }
    } catch (error) {
      // Disposing a connection could fail if error cases.
    }
    let action = CloseAction.DoNotRestart
    if (this.$state !== ClientState.Stopping && this._clientOptions.errorHandler) {
      try {
        action = this._clientOptions.errorHandler!.closed()
      } catch (error) {
        // Ignore errors coming from the error handler.
      }
    }
    this._connection = undefined
    if (action === CloseAction.DoNotRestart) {
      this.error('Connection to server got closed. Server will not be restarted.', undefined, 'force')
      this.cleanUp('stop')
      if (this.$state === ClientState.Starting) {
        this.$state = ClientState.StartFailed
      } else {
        this.$state = ClientState.Stopped
      }
      this._onStop = Promise.resolve()
      this._onStart = undefined
    } else if (action === CloseAction.Restart) {
      this.info('Connection to server got closed. Server will restart.')
      this.cleanUp('restart')
      this.$state = ClientState.Initial
      this._onStop = Promise.resolve()
      this._onStart = undefined
      this.start().catch(this.error.bind(this, `Restarting server failed`))
    }
  }

  private checkState() {
    if (this.$state === ClientState.StartFailed || this.$state === ClientState.Stopping || this.$state === ClientState.Stopped) {
      throw new ResponseError(ErrorCodes.ConnectionInactive, `Client is not running`)
    }
  }

  public handleConnectionError(error: Error, message: Message, count: number) {
    let action = this._clientOptions.errorHandler!.error(error, message, count)
    if (action === ErrorAction.Shutdown) {
      this.error(`Connection to server ${this._name} is erroring, ${error.message}. Shutting down server.`, error, 'force')
      this.stop().catch(this.error.bind(this, `Stopping server failed`))
    }
  }

  private hookConfigurationChanged(connection: Connection): void {
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(this._id)) {
        this.refreshTrace(connection, true)
      }
    }, null, this._listeners)
  }

  private refreshTrace(
    connection: Connection,
    sendNotification: boolean
  ): void {
    let config = workspace.getConfiguration(this._id, this.clientOptions.workspaceFolder)
    let trace: Trace = Trace.Off
    let traceFormat: TraceFormat = TraceFormat.Text
    if (config) {
      const traceConfig = config.get('trace.server', 'off')
      if (typeof traceConfig === 'string') {
        trace = Trace.fromString(traceConfig)
      } else {
        trace = Trace.fromString(config.get('trace.server.verbosity', 'off'))
        traceFormat = TraceFormat.fromString(config.get('trace.server.format', 'text'))
      }
    }
    if (sendNotification && this._trace == trace && this._traceFormat == traceFormat) {
      return
    }
    this._trace = trace
    this._traceFormat = traceFormat
    connection.trace(this._trace, this._tracer, {
      sendNotification,
      traceFormat: this._traceFormat
    }).catch(this.error.bind(this, `Updating trace failed with error`))
  }

  private enableVerboseTrace(): void {
    this._trace = Trace.Verbose
    this._traceFormat = TraceFormat.Text
    this._connection.trace(this._trace, this._tracer, {
      sendNotification: true,
      traceFormat: this._traceFormat
    }).catch(this.error.bind(this, `Updating trace failed with error`))
  }

  private readonly _features: (StaticFeature | DynamicFeature<any>)[] = []
  private readonly _dynamicFeatures: Map<string, DynamicFeature<any>> = new Map<
    string,
    DynamicFeature<any>
  >()

  public registerFeatures(
    features: (StaticFeature | DynamicFeature<any>)[]
  ): void {
    for (let feature of features) {
      this.registerFeature(feature, '')
    }
  }

  public registerFeature(feature: StaticFeature | DynamicFeature<any>, name: string): void {
    let { disabledFeatures } = this._clientOptions
    if (disabledFeatures.length > 0 && disabledFeatures.includes(name)) return
    this._features.push(feature)
    if (DynamicFeature.is(feature)) {
      const registrationType = feature.registrationType
      this._dynamicFeatures.set(registrationType.method, feature)
    }
  }

  public getStaticFeature(method: typeof ConfigurationRequest.method): PullConfigurationFeature
  public getStaticFeature(method: typeof WorkDoneProgressCreateRequest.method): ProgressFeature
  public getStaticFeature(method: string): StaticFeature | undefined {
    return this._features.find(o => StaticFeature.is(o) && o.method == method) as StaticFeature
  }

  public getFeature(request: typeof ExecuteCommandRequest.method): DynamicFeature<ExecuteCommandRegistrationOptions>
  public getFeature(request: typeof DidChangeWorkspaceFoldersNotification.method): DynamicFeature<void>
  public getFeature(request: typeof DidChangeWatchedFilesNotification.method): DynamicFeature<DidChangeWatchedFilesRegistrationOptions>
  public getFeature(request: typeof DidChangeConfigurationNotification.method): DynamicFeature<DidChangeConfigurationRegistrationOptions>
  public getFeature(request: typeof DidOpenTextDocumentNotification.method): DidOpenTextDocumentFeatureShape
  public getFeature(request: typeof DidChangeTextDocumentNotification.method): DidChangeTextDocumentFeatureShape
  public getFeature(request: typeof WillSaveTextDocumentNotification.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentSendFeature<(textDocument: TextDocumentWillSaveEvent) => Promise<void>>
  public getFeature(request: typeof WillSaveTextDocumentWaitUntilRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentSendFeature<(textDocument: TextDocument) => ProviderResult<TextEdit[]>>
  public getFeature(request: typeof DidSaveTextDocumentNotification.method): DidSaveTextDocumentFeatureShape
  public getFeature(request: typeof DidCloseTextDocumentNotification.method): DidCloseTextDocumentFeatureShape
  public getFeature(request: typeof DidCreateFilesNotification.method): DynamicFeature<FileOperationRegistrationOptions> & { send: (event: FileCreateEvent) => Promise<void> }
  public getFeature(request: typeof DidRenameFilesNotification.method): DynamicFeature<FileOperationRegistrationOptions> & { send: (event: FileRenameEvent) => Promise<void> }
  public getFeature(request: typeof DidDeleteFilesNotification.method): DynamicFeature<FileOperationRegistrationOptions> & { send: (event: FileDeleteEvent) => Promise<void> }
  public getFeature(request: typeof WillCreateFilesRequest.method): DynamicFeature<FileOperationRegistrationOptions> & { send: (event: FileWillCreateEvent) => Promise<void> }
  public getFeature(request: typeof WillRenameFilesRequest.method): DynamicFeature<FileOperationRegistrationOptions> & { send: (event: FileWillRenameEvent) => Promise<void> }
  public getFeature(request: typeof WillDeleteFilesRequest.method): DynamicFeature<FileOperationRegistrationOptions> & { send: (event: FileWillDeleteEvent) => Promise<void> }
  public getFeature(request: typeof CompletionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CompletionItemProvider>
  public getFeature(request: typeof HoverRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<HoverProvider>
  public getFeature(request: typeof SignatureHelpRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SignatureHelpProvider>
  public getFeature(request: typeof DefinitionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DefinitionProvider>
  public getFeature(request: typeof ReferencesRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<ReferenceProvider>
  public getFeature(request: typeof DocumentHighlightRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentHighlightProvider>
  public getFeature(request: typeof CodeActionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CodeActionProvider>
  public getFeature(request: typeof CodeLensRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CodeLensProviderShape>
  public getFeature(request: typeof DocumentFormattingRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentFormattingEditProvider>
  public getFeature(request: typeof DocumentRangeFormattingRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentRangeFormattingEditProvider>
  public getFeature(request: typeof DocumentOnTypeFormattingRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<OnTypeFormattingEditProvider>
  public getFeature(request: typeof RenameRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<RenameProvider>
  public getFeature(request: typeof DocumentSymbolRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentSymbolProvider>
  public getFeature(request: typeof DocumentLinkRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentLinkProvider>
  public getFeature(request: typeof DocumentColorRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentColorProvider>
  public getFeature(request: typeof DeclarationRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DeclarationProvider>
  public getFeature(request: typeof FoldingRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<FoldingRangeProvider>
  public getFeature(request: typeof ImplementationRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<ImplementationProvider>
  public getFeature(request: typeof SelectionRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SelectionRangeProvider>
  public getFeature(request: typeof TypeDefinitionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<TypeDefinitionProvider>
  public getFeature(request: typeof CallHierarchyPrepareRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CallHierarchyProvider>
  public getFeature(request: typeof SemanticTokensRegistrationType.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SemanticTokensProviderShape>
  public getFeature(request: typeof LinkedEditingRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<LinkedEditingRangeProvider>
  public getFeature(request: typeof TypeHierarchyPrepareRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<TypeHierarchyProvider>
  public getFeature(request: typeof InlineValueRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<InlineValueProviderShape>
  public getFeature(request: typeof InlayHintRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<InlayHintsProviderShape>
  public getFeature(request: typeof WorkspaceSymbolRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & WorkspaceProviderFeature<WorkspaceSymbolProvider>
  public getFeature(request: typeof DocumentDiagnosticRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DiagnosticProviderShape> | undefined
  public getFeature(request: string): DynamicFeature<any> | undefined {
    return this._dynamicFeatures.get(request)
  }

  protected registerBuiltinFeatures() {
    this.registerFeature(new SyncConfigurationFeature(this), 'configuration')
    this.registerFeature(new DidOpenTextDocumentFeature(this, this._syncedDocuments), 'document')
    this.registerFeature(new DidChangeTextDocumentFeature(this), 'document')
    this.registerFeature(new DidCloseTextDocumentFeature(this, this._syncedDocuments), 'document')
    this.registerFeature(new WillSaveFeature(this), 'willSave')
    this.registerFeature(new WillSaveWaitUntilFeature(this), 'willSaveWaitUntil')
    this.registerFeature(new DidSaveTextDocumentFeature(this), 'didSave')
    this.registerFeature(new FileSystemWatcherFeature(this), 'fileSystemWatcher')
    this.registerFeature(new CompletionItemFeature(this), 'completion')
    this.registerFeature(new HoverFeature(this), 'hover')
    this.registerFeature(new SignatureHelpFeature(this), 'signatureHelp')
    this.registerFeature(new ReferencesFeature(this), 'references')
    this.registerFeature(new DefinitionFeature(this), 'definition')
    this.registerFeature(new DocumentHighlightFeature(this), 'documentHighlight')
    this.registerFeature(new DocumentSymbolFeature(this), 'documentSymbol')
    this.registerFeature(new CodeActionFeature(this), 'codeAction')
    this.registerFeature(new CodeLensFeature(this), 'codeLens')
    this.registerFeature(new DocumentFormattingFeature(this), 'documentFormatting')
    this.registerFeature(new DocumentRangeFormattingFeature(this), 'documentRangeFormatting')
    this.registerFeature(new DocumentOnTypeFormattingFeature(this), 'documentOnTypeFormatting')
    this.registerFeature(new RenameFeature(this), 'rename')
    this.registerFeature(new DocumentLinkFeature(this), 'documentLink')
    this.registerFeature(new ExecuteCommandFeature(this), 'executeCommand')
    this.registerFeature(new PullConfigurationFeature(this), 'pullConfiguration')
    this.registerFeature(new TypeDefinitionFeature(this), 'typeDefinition')
    this.registerFeature(new ImplementationFeature(this), 'implementation')
    this.registerFeature(new DeclarationFeature(this), 'declaration')
    this.registerFeature(new ColorProviderFeature(this), 'colorProvider')
    this.registerFeature(new FoldingRangeFeature(this), 'foldingRange')
    this.registerFeature(new SelectionRangeFeature(this), 'selectionRange')
    this.registerFeature(new CallHierarchyFeature(this), 'callHierarchy')
    this.registerFeature(new ProgressFeature(this), 'progress')
    this.registerFeature(new LinkedEditingFeature(this), 'linkedEditing')
    this.registerFeature(new DidCreateFilesFeature(this), 'fileEvents')
    this.registerFeature(new DidRenameFilesFeature(this), 'fileEvents')
    this.registerFeature(new DidDeleteFilesFeature(this), 'fileEvents')
    this.registerFeature(new WillCreateFilesFeature(this), 'fileEvents')
    this.registerFeature(new WillRenameFilesFeature(this), 'fileEvents')
    this.registerFeature(new WillDeleteFilesFeature(this), 'fileEvents')
    this.registerFeature(new SemanticTokensFeature(this), 'semanticTokens')
    this.registerFeature(new InlayHintsFeature(this), 'inlayHint')
    this.registerFeature(new InlineValueFeature(this), 'inlineValue')
    this.registerFeature(new DiagnosticFeature(this), 'pullDiagnostic')
    this.registerFeature(new TypeHierarchyFeature(this), 'typeHierarchy')
    this.registerFeature(new WorkspaceSymbolFeature(this), 'workspaceSymbol')
    // We only register the workspace folder feature if the client is not locked
    // to a specific workspace folder.
    if (this.clientOptions.workspaceFolder === undefined) {
      this.registerFeature(new WorkspaceFoldersFeature(this), 'workspaceFolders')
    }
  }

  public registerProposedFeatures() {
    this.registerFeatures(ProposedFeatures.createAll(this))
  }

  private fillInitializeParams(params: InitializeParams): void {
    for (let feature of this._features) {
      if (Is.func(feature.fillInitializeParams)) {
        feature.fillInitializeParams(params)
      }
    }
  }

  private computeClientCapabilities(): ClientCapabilities {
    const result: ClientCapabilities = {}
    ensure(result, 'workspace')!.applyEdit = true
    const workspaceEdit = ensure(ensure(result, 'workspace')!, 'workspaceEdit')!
    workspaceEdit.documentChanges = true
    workspaceEdit.resourceOperations = [ResourceOperationKind.Create, ResourceOperationKind.Rename, ResourceOperationKind.Delete]
    workspaceEdit.failureHandling = FailureHandlingKind.Undo
    workspaceEdit.normalizesLineEndings = true
    workspaceEdit.changeAnnotationSupport = {
      groupsOnLabel: false
    }
    const diagnostics = ensure(ensure(result, 'textDocument')!, 'publishDiagnostics')!
    diagnostics.relatedInformation = true
    diagnostics.versionSupport = true
    diagnostics.tagSupport = { valueSet: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated] }
    diagnostics.codeDescriptionSupport = true
    diagnostics.dataSupport = true

    const windowCapabilities = ensure(result, 'window')!
    const showMessage = ensure(windowCapabilities, 'showMessage')!
    showMessage.messageActionItem = { additionalPropertiesSupport: true }
    const showDocument = ensure(windowCapabilities, 'showDocument')!
    showDocument.support = true

    const generalCapabilities = ensure(result, 'general')!
    generalCapabilities.regularExpressions = { engine: 'ECMAScript', version: 'ES2020' }
    generalCapabilities.markdown = { parser: 'marked', version: '4.0.10' }
    generalCapabilities.positionEncodings = ['utf-16']
    // Added in 3.17.0
    // if (this._clientOptions.markdown.supportHtml) {
    //   generalCapabilities.markdown.allowedTags = ['ul', 'li', 'p', 'code', 'blockquote', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'em', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'del', 'a', 'strong', 'br', 'img', 'span']
    // }
    generalCapabilities.staleRequestSupport = {
      cancel: true,
      retryOnContentModified: Array.from(BaseLanguageClient.RequestsToCancelOnContentModified)
    }
    for (let feature of this._features) {
      feature.fillClientCapabilities(result)
    }
    return result
  }

  private initializeFeatures(_connection: Connection): void {
    let documentSelector = this._clientOptions.documentSelector
    for (let feature of this._features) {
      if (Is.func(feature.preInitialize)) {
        feature.preInitialize(this._capabilities, documentSelector)
      }
    }
    for (let feature of this._features) {
      feature.initialize(this._capabilities, documentSelector)
    }
  }

  private handleRegistrationRequest(params: RegistrationParams): void {
    if (this.clientOptions.disableDynamicRegister) return
    // We will not receive a registration call before a client is running
    // from a server. However if we stop or shutdown we might which might
    // try to restart the server. So ignore registrations if we are not running
    if (!this.isRunning()) {
      for (const registration of params.registrations) {
        this._ignoredRegistrations.add(registration.id)
      }
      return
    }
    for (const registration of params.registrations) {
      const feature = this._dynamicFeatures.get(registration.method)
      if (!feature) {
        this.error(`No feature implementation for ${registration.method} found. Registration failed.`)
        return
      }
      const options = registration.registerOptions ?? {}
      options.documentSelector = options.documentSelector ?? this._clientOptions.documentSelector
      const data: RegistrationData<any> = {
        id: registration.id,
        registerOptions: options
      }
      feature.register(data)
    }
  }

  private handleUnregistrationRequest(
    params: UnregistrationParams
  ): Promise<void> {
    return new Promise<void>(resolve => {
      for (let unregistration of params.unregisterations) {
        if (this._ignoredRegistrations.has(unregistration.id)) continue
        const feature = this._dynamicFeatures.get(unregistration.method)
        if (feature) feature.unregister(unregistration.id)
      }
      resolve()
    })
  }

  private setDiagnostics(uri: string, diagnostics: Diagnostic[] | undefined) {
    if (!this._diagnostics) return

    const separate = this.clientOptions.separateDiagnostics
    // TODO make is async
    if (separate && diagnostics.length > 0) {
      const entries: Map<string, Diagnostic[]> = new Map()
      entries.set(uri, diagnostics)
      for (const diagnostic of diagnostics) {
        if (diagnostic.relatedInformation?.length) {
          let message = `${diagnostic.message}\n\nRelated diagnostics:\n`
          for (const info of diagnostic.relatedInformation) {
            const basename = path.basename(URI.parse(info.location.uri).fsPath)
            const ln = info.location.range.start.line
            message = `${message}\n${basename}(line ${ln + 1}): ${info.message}`

            const diags: Diagnostic[] = entries.get(info.location.uri) || []
            diags.push(Diagnostic.create(info.location.range, info.message, DiagnosticSeverity.Hint, diagnostic.code, diagnostic.source))
            entries.set(info.location.uri, diags)
          }
          diagnostic.message = message
        }
        this._diagnostics.set(Array.from(entries))
      }
    } else {
      this._diagnostics.set(uri, diagnostics)
    }
  }

  private handleApplyWorkspaceEdit(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> {
    // This is some sort of workaround since the version check should be done by VS Code in the Workspace.applyEdit.
    // However doing it here adds some safety since the server can lag more behind then an extension.
    let workspaceEdit: WorkspaceEdit = params.edit
    let openTextDocuments: Map<string, TextDocument> = new Map<string, TextDocument>()
    workspace.textDocuments.forEach(document => openTextDocuments.set(document.uri.toString(), document))
    let versionMismatch = false
    if (workspaceEdit.documentChanges) {
      for (const change of workspaceEdit.documentChanges) {
        if (TextDocumentEdit.is(change) && change.textDocument.version && change.textDocument.version >= 0) {
          let textDocument = openTextDocuments.get(change.textDocument.uri)
          if (textDocument && textDocument.version !== change.textDocument.version) {
            versionMismatch = true
            break
          }
        }
      }
    }
    if (versionMismatch) {
      return Promise.resolve({ applied: false })
    }
    return workspace.applyEdit(params.edit).then(value => {
      return { applied: value }
    })
  }

  private static RequestsToCancelOnContentModified: Set<string> = new Set([
    InlayHintRequest.method,
    SemanticTokensRequest.method,
    SemanticTokensRangeRequest.method,
    SemanticTokensDeltaRequest.method
  ])

  public handleFailedRequest<T>(type: { method: string, [key: string]: any }, token: CancellationToken | undefined, error: unknown, defaultValue: T): T {
    if (token && token.isCancellationRequested) return defaultValue
    // If we get a request cancel or a content modified don't log anything.
    if (error instanceof ResponseError) {
      // The connection got disposed while we were waiting for a response.
      // Simply return the default value. Is the best we can do.
      if (error.code === ErrorCodes.PendingResponseRejected || error.code === ErrorCodes.ConnectionInactive) {
        return defaultValue
      }
      if (error.code === LSPErrorCodes.RequestCancelled || error.code === LSPErrorCodes.ServerCancelled) {
        if (error.data != null) {
          throw new LSPCancellationError(error.data)
        } else {
          throw new CancellationError()
        }
      } else if (error.code === LSPErrorCodes.ContentModified) {
        if (BaseLanguageClient.RequestsToCancelOnContentModified.has(type.method)) {
          throw new CancellationError()
        } else {
          return defaultValue
        }
      }
    }
    this.error(`Request ${type.method} failed.`, error)
    throw error
  }

  // Should be keeped
  public logFailedRequest(type: any, error: any): void {
    // If we get a request cancel don't log anything.
    if (
      error instanceof ResponseError &&
      error.code === LSPErrorCodes.RequestCancelled
    ) {
      return
    }
    this.error(`Request ${type.method} failed.`, error)
  }
}

const ProposedFeatures = {
  createAll: (_client: BaseLanguageClient): (StaticFeature | DynamicFeature<any>)[] => {
    let result: (StaticFeature | DynamicFeature<any>)[] = []
    return result
  }
}
