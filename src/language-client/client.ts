'use strict'
import { ApplyWorkspaceEditParams, ApplyWorkspaceEditResult, CallHierarchyPrepareRequest, CancellationStrategy, CancellationToken, ClientCapabilities, CodeActionRequest, CodeLensRequest, CompletionRequest, ConfigurationRequest, ConnectionStrategy, DeclarationRequest, DefinitionRequest, DidChangeConfigurationNotification, DidChangeConfigurationRegistrationOptions, DidChangeTextDocumentNotification, DidChangeWatchedFilesNotification, DidChangeWatchedFilesRegistrationOptions, DidChangeWorkspaceFoldersNotification, DidCloseTextDocumentNotification, DidCloseTextDocumentParams, DidCreateFilesNotification, DidDeleteFilesNotification, DidOpenTextDocumentNotification, DidRenameFilesNotification, DidSaveTextDocumentNotification, Disposable, DocumentColorRequest, DocumentDiagnosticRequest, DocumentFormattingRequest, DocumentHighlightRequest, DocumentLinkRequest, DocumentOnTypeFormattingRequest, DocumentRangeFormattingRequest, DocumentSelector, DocumentSymbolRequest, ExecuteCommandRegistrationOptions, ExecuteCommandRequest, FileEvent, FileOperationRegistrationOptions, FoldingRangeRequest, GenericNotificationHandler, GenericRequestHandler, HandlerResult, HoverRequest, ImplementationRequest, InitializeParams, InitializeResult, InlineCompletionRequest, InlineValueRequest, LinkedEditingRangeRequest, Message, MessageActionItem, MessageSignature, NotificationHandler, NotificationHandler0, NotificationType, NotificationType0, ProgressToken, ProgressType, ProtocolNotificationType, ProtocolNotificationType0, ProtocolRequestType, ProtocolRequestType0, PublishDiagnosticsParams, ReferencesRequest, RegistrationParams, RenameRequest, RequestHandler, RequestHandler0, RequestType, RequestType0, SelectionRangeRequest, SemanticTokensRegistrationType, ServerCapabilities, ShowDocumentParams, ShowDocumentResult, ShowMessageRequestParams, SignatureHelpRequest, TextDocumentContentRequest, TextDocumentRegistrationOptions, TextDocumentSyncOptions, TextEdit, TraceOptions, Tracer, TypeDefinitionRequest, TypeHierarchyPrepareRequest, UnregistrationParams, WillCreateFilesRequest, WillDeleteFilesRequest, WillRenameFilesRequest, WillSaveTextDocumentNotification, WillSaveTextDocumentWaitUntilRequest, WorkDoneProgressBegin, WorkDoneProgressCreateRequest, WorkDoneProgressEnd, WorkDoneProgressReport, WorkspaceSymbolRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import { Diagnostic, DiagnosticTag, MarkupKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent, TextDocumentWillSaveEvent } from '../core/files'
import DiagnosticCollection from '../diagnostic/collection'
import languages from '../languages'
import { createLogger } from '../logger'
import type { MessageItem } from '../model/notification'
import { CallHierarchyProvider, CodeActionProvider, CompletionItemProvider, DeclarationProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentHighlightProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentSymbolProvider, FoldingRangeProvider, HoverProvider, ImplementationProvider, InlineCompletionItemProvider, LinkedEditingRangeProvider, OnTypeFormattingEditProvider, ProviderResult, ReferenceProvider, RenameProvider, SelectionRangeProvider, SignatureHelpProvider, TypeDefinitionProvider, TypeHierarchyProvider, WorkspaceSymbolProvider } from '../provider'
import { OutputChannel, Thenable } from '../types'
import { defaultValue, disposeAll, getConditionValue } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { CancellationError, onUnexpectedError } from '../util/errors'
import { parseExtensionName } from '../util/extensionRegistry'
import { sameFile } from '../util/fs'
import * as Is from '../util/is'
import { os } from '../util/node'
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
import { $DiagnosticPullOptions, DiagnosticFeature, DiagnosticFeatureShape, DiagnosticProviderMiddleware, DiagnosticProviderShape, DiagnosticPullMode } from './diagnostic'
import { DocumentHighlightFeature, DocumentHighlightMiddleware } from './documentHighlight'
import { DocumentLinkFeature, DocumentLinkMiddleware } from './documentLink'
import { DocumentSymbolFeature, DocumentSymbolMiddleware } from './documentSymbol'
import { ExecuteCommandFeature, ExecuteCommandMiddleware } from './executeCommand'
import { Connection, DynamicFeature, ensure, FeatureClient, LSPCancellationError, RegistrationData, StaticFeature, TextDocumentProviderFeature, TextDocumentSendFeature } from './features'
import { DidCreateFilesFeature, DidDeleteFilesFeature, DidRenameFilesFeature, FileOperationsMiddleware, WillCreateFilesFeature, WillDeleteFilesFeature, WillRenameFilesFeature } from './fileOperations'
import { DidChangeWatchedFileSignature, FileSystemWatcherFeature } from './fileSystemWatcher'
import { FoldingRangeFeature, FoldingRangeProviderMiddleware, FoldingRangeProviderShape } from './foldingRange'
import { $FormattingOptions, DocumentFormattingFeature, DocumentOnTypeFormattingFeature, DocumentRangeFormattingFeature, FormattingMiddleware } from './formatting'
import { HoverFeature, HoverMiddleware } from './hover'
import { ImplementationFeature, ImplementationMiddleware } from './implementation'
import { InlayHintsFeature, InlayHintsMiddleware, InlayHintsProviderShape } from './inlayHint'
import { InlineCompletionItemFeature, InlineCompletionMiddleware } from './inlineCompletion'
import { InlineValueFeature, InlineValueMiddleware, InlineValueProviderShape } from './inlineValue'
import { LinkedEditingFeature, LinkedEditingRangeMiddleware } from './linkedEditingRange'
import { ProgressFeature } from './progress'
import { ProgressPart } from './progressPart'
import { ReferencesFeature, ReferencesMiddleware } from './reference'
import { RenameFeature, RenameMiddleware } from './rename'
import { SelectionRangeFeature, SelectionRangeProviderMiddleware } from './selectionRange'
import { SemanticTokensFeature, SemanticTokensMiddleware, SemanticTokensProviderShape } from './semanticTokens'
import { SignatureHelpFeature, SignatureHelpMiddleware } from './signatureHelp'
import { TextDocumentContentFeature, TextDocumentContentMiddleware, TextDocumentContentProviderShape } from './textDocumentContent'
import { DidChangeTextDocumentFeature, DidChangeTextDocumentFeatureShape, DidCloseTextDocumentFeature, DidCloseTextDocumentFeatureShape, DidOpenTextDocumentFeature, DidOpenTextDocumentFeatureShape, DidSaveTextDocumentFeature, DidSaveTextDocumentFeatureShape, ResolvedTextDocumentSyncCapabilities, TextDocumentSynchronizationMiddleware, WillSaveFeature, WillSaveWaitUntilFeature } from './textSynchronization'
import { TypeDefinitionFeature, TypeDefinitionMiddleware } from './typeDefinition'
import { TypeHierarchyFeature, TypeHierarchyMiddleware } from './typeHierarchy'
import { currentTimeStamp, data2String, fixNotificationType, fixRequestType, getLocale, getTracePrefix, toMethod } from './utils'
import { Delayer } from './utils/async'
import * as c2p from './utils/codeConverter'
import { CloseAction, CloseHandlerResult, DefaultErrorHandler, ErrorAction, ErrorHandler, ErrorHandlerResult, InitializationFailedHandler, toCloseHandlerResult } from './utils/errorHandler'
import { ConsoleLogger, NullLogger } from './utils/logger'
import * as UUID from './utils/uuid'
import { $WorkspaceOptions, WorkspaceFolderMiddleware, WorkspaceFoldersFeature } from './workspaceFolders'
import { WorkspaceProviderFeature, WorkspaceSymbolFeature, WorkspaceSymbolMiddleware } from './workspaceSymbol'

const logger = createLogger('language-client-client')

export { CloseAction, DiagnosticPullMode, ErrorAction, NullLogger }

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

  connection.onError(data => { errorHandler(data[0], data[1], data[2]) })
  connection.onClose(closeHandler)
  let result: Connection = {
    id: '',
    listen: (): void => connection.listen(),

    hasPendingResponse: connection.hasPendingResponse,

    sendRequest: connection.sendRequest,
    onRequest: connection.onRequest,

    sendNotification: connection.sendNotification,
    onNotification: connection.onNotification,

    onProgress: connection.onProgress,
    sendProgress: connection.sendProgress,

    trace: (value: Trace, tracer: Tracer, traceOptions: TraceOptions): Promise<void> => {
      return connection.trace(value, tracer, traceOptions)
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
  Debug = 0,
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

interface _WorkspaceMiddleware {
  didChangeWatchedFile?: (this: void, event: FileEvent, next: DidChangeWatchedFileSignature) => Promise<void>
  handleApplyEdit?: (this: void, params: ApplyWorkspaceEditParams, next: ApplyWorkspaceEditRequest.HandlerSignature) => HandlerResult<ApplyWorkspaceEditResult, void>
}

export type WorkspaceMiddleware = _WorkspaceMiddleware & ConfigurationMiddleware & DidChangeConfigurationMiddleware & WorkspaceFolderMiddleware & FileOperationsMiddleware

export interface _WindowMiddleware {
  showDocument?: ShowDocumentRequest.MiddlewareSignature
}

export type WindowMiddleware = _WindowMiddleware

/**
 * The Middleware lets extensions intercept the request and notifications send and received
 * from the server
 */
export interface _Middleware {
  handleDiagnostics?: (this: void, uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => void
  handleWorkDoneProgress?: (this: void, token: ProgressToken, params: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd, next: HandleWorkDoneProgressSignature) => void
  handleRegisterCapability?: (this: void, params: RegistrationParams, next: RegistrationRequest.HandlerSignature) => Promise<void>
  handleUnregisterCapability?: (this: void, params: UnregistrationParams, next: UnregistrationRequest.HandlerSignature) => Promise<void>
  workspace?: WorkspaceMiddleware
  window?: WindowMiddleware
}

// A general middleware is applied to both requests and notifications
interface GeneralMiddleware {
  sendRequest?<P, R>(
    this: void,
    type: string | MessageSignature,
    param: P | undefined,
    token: CancellationToken | undefined,
    next: (type: string | MessageSignature, param?: P, token?: CancellationToken) => Promise<R>,
  ): Promise<R>

  sendNotification?<R>(
    this: void,
    type: string | MessageSignature,
    next: (type: string | MessageSignature, params?: R) => Promise<void>,
    params: R
  ): Promise<void>
}

export type Middleware = _Middleware & TextDocumentSynchronizationMiddleware & SignatureHelpMiddleware & ReferencesMiddleware &
  DefinitionMiddleware & DocumentHighlightMiddleware & DocumentSymbolMiddleware & DocumentLinkMiddleware &
  CodeActionMiddleware & FormattingMiddleware & RenameMiddleware & CodeLensMiddleware &
  HoverMiddleware & CompletionMiddleware & ExecuteCommandMiddleware & TypeDefinitionMiddleware &
  ImplementationMiddleware & ColorProviderMiddleware & DeclarationMiddleware &
  FoldingRangeProviderMiddleware & CallHierarchyMiddleware & SemanticTokensMiddleware &
  InlayHintsMiddleware & InlineCompletionMiddleware & InlineValueMiddleware & TypeHierarchyMiddleware &
  WorkspaceSymbolMiddleware & DiagnosticProviderMiddleware & LinkedEditingRangeMiddleware &
  SelectionRangeProviderMiddleware & GeneralMiddleware & TextDocumentContentMiddleware

export type LanguageClientOptions = {
  rootPatterns?: string[]
  requireRootPattern?: boolean
  documentSelector?: DocumentSelector
  disableMarkdown?: boolean
  disableDiagnostics?: boolean
  diagnosticCollectionName?: string
  disableDynamicRegister?: boolean
  disabledFeatures?: string[]
  outputChannelName?: string
  traceOutputChannel?: OutputChannel
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
  uriConverter?: {
    code2Protocol: c2p.URIConverter
  }
  connectionOptions?: ConnectionOptions
  markdown?: {
    isTrusted?: boolean
    supportHtml?: boolean
  }
  textSynchronization?: {
    /**
     * Delays sending the open notification until one of the following
     * conditions becomes `true`:
     * - document is visible in the editor.
     * - any of the other notifications or requests is sent to the server, except
     * a closed notification for the pending document.
     */
    delayOpenNotifications?: boolean
  }
} & $ConfigurationOptions & $CompletionOptions & $FormattingOptions & $DiagnosticPullOptions & $WorkspaceOptions

type ResolvedClientOptions = {
  disabledFeatures: string[]
  disableMarkdown: boolean
  disableDynamicRegister: boolean
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
  uriConverter?: {
    code2Protocol: c2p.URIConverter
  }
  connectionOptions?: ConnectionOptions
  markdown: {
    isTrusted: boolean
    supportHtml?: boolean
  }
  textSynchronization: {
    delayOpenNotifications?: boolean
  }
} & $ConfigurationOptions & Required<$CompletionOptions> & Required<$FormattingOptions> & Required<$DiagnosticPullOptions> & Required<$WorkspaceOptions>

export enum State {
  Stopped = 1,
  Running = 2,
  Starting = 3,
  StartFailed = 4,
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

export enum ShutdownMode {
  Restart = 'restart',
  Stop = 'stop'
}

const delayTime = getConditionValue(250, 10)

export abstract class BaseLanguageClient implements FeatureClient<Middleware, LanguageClientOptions> {
  private _rootPath: string | false
  private _consoleDebug = false
  private __extensionName: string
  private _id: string
  private _name: string
  private _clientOptions: ResolvedClientOptions

  protected _state: ClientState
  private _onStart: Promise<void> | undefined
  private _onStop: Promise<void> | undefined
  private _connection: Connection | undefined
  private _initializeResult: InitializeResult | undefined
  private _outputChannel: OutputChannel | undefined
  private _traceOutputChannel: OutputChannel | undefined
  private _capabilities: ServerCapabilities & ResolvedTextDocumentSyncCapabilities
  private _disposed: 'disposing' | 'disposed' | undefined
  private readonly _ignoredRegistrations: Set<string>
  private readonly _listeners: Disposable[]

  private readonly _notificationHandlers: Map<string, GenericNotificationHandler>
  private readonly _notificationDisposables: Map<string, Disposable>
  private readonly _pendingNotificationHandlers: Map<string, GenericNotificationHandler>
  private readonly _requestHandlers: Map<string, GenericRequestHandler<unknown, unknown>>
  private readonly _requestDisposables: Map<string, Disposable>
  private readonly _pendingRequestHandlers: Map<string, GenericRequestHandler<unknown, unknown>>
  private readonly _progressHandlers: Map<string | number, { type: ProgressType<any>; handler: NotificationHandler<any> }>
  private readonly _pendingProgressHandlers: Map<string | number, { type: ProgressType<any>; handler: NotificationHandler<any> }>
  private readonly _progressDisposables: Map<string | number, Disposable>

  private _fileEvents: FileEvent[]
  private _fileEventDelayer: Delayer<void>

  private _diagnostics: DiagnosticCollection | undefined
  private _syncedDocuments: Map<string, TextDocument>

  private _traceFormat: TraceFormat
  private _trace: Trace
  private _tracer: Tracer
  private _stateChangeEmitter: Emitter<StateChangeEvent>

  private readonly _c2p: c2p.Converter
  private _didOpenTextDocumentFeature: DidOpenTextDocumentFeature | undefined

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
    this._traceOutputChannel = clientOptions.traceOutputChannel
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

    this._fileEvents = []
    this._fileEventDelayer = new Delayer<void>(delayTime)
    this._ignoredRegistrations = new Set()
    this._onStop = undefined
    this._stateChangeEmitter = new Emitter<StateChangeEvent>()
    this._trace = Trace.Off
    this._tracer = {
      log: (messageOrDataObject: string | any, data?: string) => {
        if (Is.string(messageOrDataObject)) {
          this.traceMessage(messageOrDataObject, data)
        } else {
          this.traceObject(messageOrDataObject)
        }
      }
    }
    this._c2p = c2p.createConverter(clientOptions.uriConverter ? clientOptions.uriConverter.code2Protocol : undefined)
    this._syncedDocuments = new Map<string, TextDocument>()
    this.registerBuiltinFeatures()
    Error.captureStackTrace(this)
  }

  public switchConsole(): void {
    this._consoleDebug = !this._consoleDebug
    this.changeTrace(Trace.Verbose, TraceFormat.Text)
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
    return {
      disabledFeatures,
      disableMarkdown,
      disableSnippetCompletion,
      diagnosticPullOptions: pullOption,
      rootPatterns: defaultValue(clientOptions.rootPatterns, []),
      requireRootPattern: clientOptions.requireRootPattern,
      disableDynamicRegister: clientOptions.disableDynamicRegister,
      formatterPriority: defaultValue(clientOptions.formatterPriority, 0),
      ignoredRootPaths: defaultValue(clientOptions.ignoredRootPaths, []),
      documentSelector: defaultValue(clientOptions.documentSelector, []),
      synchronize: defaultValue(clientOptions.synchronize, {}),
      diagnosticCollectionName: clientOptions.diagnosticCollectionName,
      outputChannelName: defaultValue(clientOptions.outputChannelName, this._id),
      revealOutputChannelOn: defaultValue(clientOptions.revealOutputChannelOn, RevealOutputChannelOn.Never),
      stdioEncoding: defaultValue(clientOptions.stdioEncoding, 'utf8'),
      initializationOptions: clientOptions.initializationOptions,
      initializationFailedHandler: clientOptions.initializationFailedHandler,
      progressOnInitialization: clientOptions.progressOnInitialization === true,
      errorHandler: clientOptions.errorHandler ?? this.createDefaultErrorHandler(clientOptions.connectionOptions?.maxRestartCount),
      middleware: defaultValue(clientOptions.middleware, {}),
      workspaceFolder: clientOptions.workspaceFolder,
      connectionOptions: clientOptions.connectionOptions,
      uriConverter: clientOptions.uriConverter,
      textSynchronization: this.createTextSynchronizationOptions(clientOptions.textSynchronization),
      markdown
    }
  }

  private createTextSynchronizationOptions(options: LanguageClientOptions['textSynchronization']): ResolvedClientOptions['textSynchronization'] {
    if (options && typeof options.delayOpenNotifications === 'boolean') {
      return { delayOpenNotifications: options.delayOpenNotifications }
    }
    return { delayOpenNotifications: false }
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

  public get code2ProtocolConverter(): c2p.Converter {
    return this._c2p
  }

  public getPublicState(): State {
    switch (this.$state) {
      case ClientState.Starting:
        return State.Starting
      case ClientState.Running:
        return State.Running
      case ClientState.StartFailed:
        return State.StartFailed
      default:
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
    if (this.$state === ClientState.StartFailed || this.$state === ClientState.Stopping || this.$state === ClientState.Stopped) {
      return Promise.reject(new ResponseError(ErrorCodes.ConnectionInactive, `Client is not running`))
    }
    const connection = await this.$start()
    // Send only depending open notifications
    await this._didOpenTextDocumentFeature!.sendPendingOpenNotifications()

    let param: any | undefined
    let token: CancellationToken | undefined
    // Separate cancellation tokens from other parameters for a better client interface
    if (params.length === 1) {
      // CancellationToken is an interface, so we need to check if the first param complies to it
      if (CancellationToken.is(params[0])) {
        token = params[0]
      } else {
        param = params[0]
      }
    } else if (params.length === 2) {
      param = params[0]
      token = params[1]
    }
    if (token !== undefined && token.isCancellationRequested) {
      return Promise.reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled'))
    }
    type = fixRequestType(type, params)
    const _sendRequest = this._clientOptions.middleware.sendRequest
    if (_sendRequest !== undefined) {
      // Return the general middleware invocation defining `next` as a utility function that reorganizes parameters to
      // pass them to the original sendRequest function.
      return _sendRequest(type, param, token, (type, param, token) => {
        const params: any[] = []

        // Add the parameters if there are any
        if (param !== undefined) {
          params.push(param)
        }

        // Add the cancellation token if there is one
        if (token !== undefined) {
          params.push(token)
        }

        return connection.sendRequest<R>(type, ...params)
      })
    } else {
      return connection.sendRequest<R>(type, ...params)
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
      this.error(`Client is not running when send notification`, type)
      return
    }
    try {
      let documentToClose: string | undefined
      if (typeof type !== 'string' && type.method === DidCloseTextDocumentNotification.method) {
        documentToClose = (params as DidCloseTextDocumentParams).textDocument.uri
      }
      const connection = await this.$start()
      // Send only depending open notifications
      await this._didOpenTextDocumentFeature!.sendPendingOpenNotifications(documentToClose)

      type = fixNotificationType(type, params == null ? [] : [params])
      const _sendNotification = this._clientOptions.middleware.sendNotification
      return await Promise.resolve(_sendNotification
        ? _sendNotification(type, connection.sendNotification.bind(connection), params)
        : connection.sendNotification(type, params))
    } catch (error) {
      this.error(`Sending notification ${toMethod(type)} failed.`, error)
      if ([ClientState.Stopping, ClientState.Stopped].includes(this._state)) return
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
    if (this.$state === ClientState.StartFailed || this.$state === ClientState.Stopping || this.$state === ClientState.Stopped) {
      return Promise.reject(new ResponseError(ErrorCodes.ConnectionInactive, `Client is not running`))
    }
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
    let section = defaultValue(this._clientOptions.synchronize, {}).configurationSection
    return typeof section === 'string' && section.startsWith('languageserver.') ? section : undefined
  }

  public get clientOptions(): ResolvedClientOptions {
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

  public get traceOutputChannel(): OutputChannel {
    return this._traceOutputChannel ? this._traceOutputChannel : this.outputChannel
  }

  public get diagnostics(): DiagnosticCollection | undefined {
    return this._diagnostics
  }

  public createDefaultErrorHandler(maxRestartCount?: number): ErrorHandler {
    return new DefaultErrorHandler(this._id, maxRestartCount ?? 4, this._outputChannel)
  }

  public set trace(value: Trace) {
    this.changeTrace(value, this._traceFormat)
  }

  private consoleMessage(message: string, error = false): void {
    if (this._consoleDebug) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      error ? console.error(redOpen + message + redClose) : console.log(message)
    }
  }

  public debug(message: string, data?: any, showNotification = true): void {
    this.logOutputMessage(MessageType.Debug, RevealOutputChannelOn.Debug, 'Debug', message, data, showNotification)
  }

  public info(message: string, data?: any, showNotification = true): void {
    this.logOutputMessage(MessageType.Info, RevealOutputChannelOn.Info, 'Info', message, data, showNotification)
  }

  public warn(message: string, data?: any, showNotification = true): void {
    this.logOutputMessage(MessageType.Warning, RevealOutputChannelOn.Warn, 'Warn', message, data, showNotification)
  }

  public error(message: string, data?: any, showNotification: boolean | 'force' = true): void {
    this.logOutputMessage(MessageType.Error, RevealOutputChannelOn.Error, 'Error', message, data, showNotification)
  }

  private logOutputMessage(type: MessageType, reveal: RevealOutputChannelOn, name: string, message: string, data: any | undefined, showNotification: boolean | 'force'): void {
    const msg = `[${name.padEnd(5)} - ${currentTimeStamp()}] ${this.getLogMessage(message, data)}`
    this.outputChannel.appendLine(msg)
    this.consoleMessage(msg, type === MessageType.Error)
    if (showNotification === 'force' || (showNotification && this._clientOptions.revealOutputChannelOn <= reveal)) {
      this.showNotificationMessage(type, message, data)
    }
  }

  private traceObject(data: any): void {
    this.traceOutputChannel.appendLine(`${getTracePrefix(data)}${data2String(data)}`)
  }

  public traceMessage(message: string, data?: any): void {
    const msg = `[Trace - ${currentTimeStamp()}] ${this.getLogMessage(message, data)}`
    this.traceOutputChannel.appendLine(msg)
    this.consoleMessage(msg)
  }

  private getLogMessage(message: string, data?: any): string {
    return data != null ? `${message}\n${data2String(data)}` : message
  }

  private showNotificationMessage(type: MessageType, message?: string, data?: any) {
    message = message ?? 'A request has failed. See the output for more information.'
    if (data) {
      message += '\n' + data2String(data)
    }

    const messageFunc = type === MessageType.Error
      ? window.showErrorMessage.bind(window)
      : type === MessageType.Warning
        ? window.showWarningMessage.bind(window)
        : window.showInformationMessage.bind(window)
    let fn = getConditionValue(messageFunc, (_, _obj) => Promise.resolve(global.__showOutput))
    fn(message, { title: 'Go to output' }).then(selection => {
      if (selection !== undefined) {
        this.outputChannel.show(true)
      }
    }, onUnexpectedError)
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
        case MessageType.Debug:
          this.debug(message.message)
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
      return messageFunc(params.message, ...actions)
    })
    connection.onRequest(ShowDocumentRequest.type, async (params, token) => {
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
        return middleware(params, token, showDocument)
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
    this.refreshTrace(false)
    let rootPath = this._rootPath
    let initParams: InitializeParams = {
      processId: process.pid,
      rootPath: rootPath ? rootPath : null,
      rootUri: rootPath ? this.code2ProtocolConverter.asUri(URI.file(rootPath)) : null,
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
      }, (error: Error) => {
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
      for (let requestType of [RegistrationRequest.type, 'client/registerFeature']) {
        connection.onRequest(requestType, params => this.handleRegistrationRequest(params))
      }
      for (let requestType of [UnregistrationRequest.type, 'client/unregisterFeature']) {
        connection.onRequest(requestType, params => this.handleUnregistrationRequest(params))
      }
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
      this.hookConfigurationChanged()
      this.initializeFeatures(connection)
      return result
    } catch (error: any) {
      this.error('Server initialization failed.', error)
      logger.error(`Server "${this.id}" initialization failed.`, error)
      let cb = (retry: boolean) => {
        process.nextTick(() => {
          new Promise((resolve, reject) => {
            if (retry) {
              this.initialize(connection).then(resolve, reject)
            } else {
              this.stop().then(resolve, reject)
            }
          }).catch(err => {
            this.error(`Unexpected error`, err, false)
          })
        })
      }
      if (this._clientOptions.initializationFailedHandler) {
        cb(this._clientOptions.initializationFailedHandler(error))
      } else if (error instanceof ResponseError && error.data && error.data.retry) {
        void window.showErrorMessage(error.message, { title: 'Retry', id: 'retry' }).then(item => {
          cb(item && item.id === 'retry')
        })
      } else {
        if (error && error.message) {
          void window.showErrorMessage(toText(error.message))
        }
        cb(false)
      }
      throw error
    }
  }

  public stop(timeout = 2000): Promise<void> {
    // Wait 2 seconds on stop
    return this.shutdown(ShutdownMode.Stop, timeout)
  }

  protected async shutdown(mode: ShutdownMode, timeout: number): Promise<void> {
    // If the client is stopped or in its initial state return.
    if (this.$state === ClientState.Stopped || this.$state === ClientState.Initial) {
      return
    }
    if (this.$state === ClientState.Starting && this._onStart) {
      await this._onStart
    }
    // If we are stopping the client and have a stop promise return it.
    if (this.$state === ClientState.Stopping) {
      return this._onStop
    }

    const connection = this._connection
    // We can't stop a client that is not running (e.g. has no connection). Especially not
    // on that us starting since it can't be correctly synchronized.
    if (connection === undefined || (this.$state !== ClientState.Running && this.$state !== ClientState.StartFailed)) {
      throw new Error(`Client is not running and can't be stopped. It's current state is: ${this.$state}`)
    }
    this._initializeResult = undefined
    this.$state = ClientState.Stopping
    this.cleanUp(mode)

    let tm: NodeJS.Timeout
    const tp = new Promise<any>(c => { tm = setTimeout(c, timeout) })
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
      if (mode === 'stop') {
        this.cleanUpChannel()
      }
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

  private cleanUp(mode: ShutdownMode): void {
    this._fileEvents = []
    this._fileEventDelayer.cancel()

    if (this._listeners) {
      disposeAll(this._listeners)
    }

    if (this._syncedDocuments) {
      this._syncedDocuments.clear()
    }
    // Clear features in reverse order;
    for (const feature of Array.from(this._features.entries()).map(entry => entry[1]).reverse()) {
      if (typeof feature.dispose === 'function') {
        feature.dispose()
      }
    }
    if ((mode === ShutdownMode.Stop || mode === ShutdownMode.Restart) && this._diagnostics !== undefined) {
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

  public notifyFileEvent(event: FileEvent | undefined): void {
    const didChangeWatchedFile = async (event: FileEvent | undefined): Promise<void> => {
      if (event) this._fileEvents.push(event)
      return this._fileEventDelayer.trigger(async (): Promise<void> => {
        const fileEvents = this._fileEvents
        if (fileEvents.length === 0) return
        this._fileEvents = []
        try {
          await this.sendNotification(DidChangeWatchedFilesNotification.type, { changes: fileEvents })
        } catch (error) {
          // Restore the file events.
          this._fileEvents = fileEvents
          throw error
        }
      })
    }
    const workSpaceMiddleware = this.clientOptions.middleware.workspace;
    (workSpaceMiddleware?.didChangeWatchedFile ? workSpaceMiddleware.didChangeWatchedFile(event, didChangeWatchedFile) : didChangeWatchedFile(event)).catch(error => {
      this.error(`Notifying ${DidChangeWatchedFilesNotification.method} failed.`, error)
    })
  }

  /**
   * @deprecated
   */
  public async forceDocumentSync(): Promise<void> {
  }

  public isSynced(uri: string): boolean {
    return this._syncedDocuments ? this._syncedDocuments.has(uri) : false
  }

  protected abstract createMessageTransports(encoding: string): Promise<MessageTransports | null>

  private async createConnection(): Promise<Connection> {
    let onError = error => {
      this.error(`Unexpected connection error: `, error)
    }
    let errorHandler = (error: Error, message: Message | undefined, count: number | undefined) => {
      this.handleConnectionError(error, message, count).catch(onError)
    }
    let closeHandler = () => {
      this.handleConnectionClosed().catch(onError)
    }
    const transports = await this.createMessageTransports(defaultValue(this._clientOptions.stdioEncoding, 'utf8'))
    this._connection = createConnection(transports.reader, transports.writer, errorHandler, closeHandler, this._clientOptions.connectionOptions)
    return this._connection
  }

  protected async handleConnectionClosed(): Promise<void> {
    // Check whether this is a normal shutdown in progress or the client stopped normally.
    if (this.$state === ClientState.Stopped) {
      logger.info(`client ${this._id} normal closed`)
      return
    }
    try {
      if (this._connection !== undefined) {
        this._connection.dispose()
      }
    } catch (error) {
      // Disposing a connection could fail if error cases.
    }
    let handlerResult: CloseHandlerResult = { action: CloseAction.DoNotRestart }
    let err
    if (this.$state !== ClientState.Stopping) {
      try {
        let result = await this._clientOptions.errorHandler.closed()
        handlerResult = toCloseHandlerResult(result)
      } catch (error) {
        err = error
      }
    }
    this._connection = undefined
    if (handlerResult.action === CloseAction.DoNotRestart) {
      this.error(handlerResult.message ?? 'Connection to server got closed. Server will not be restarted.', undefined, handlerResult.handled === true ? false : 'force')
      this.cleanUp(ShutdownMode.Stop)
      if (this.$state === ClientState.Starting) {
        this.$state = ClientState.StartFailed
      } else {
        this.$state = ClientState.Stopped
      }
      this._onStop = Promise.resolve()
      this._onStart = undefined
    } else if (handlerResult.action === CloseAction.Restart) {
      this.info(handlerResult.message ?? 'Connection to server got closed. Server will restart.', undefined, !handlerResult.handled)
      this.cleanUp(ShutdownMode.Restart)
      this.$state = ClientState.Initial
      this._onStop = Promise.resolve()
      this._onStart = undefined
      this.start().catch(error => {
        this.error(`Restarting server failed`, error, 'force')
      })
    }
    if (err) throw err
  }

  public async handleConnectionError(error: Error, message: Message | undefined, count: number): Promise<void> {
    let res = await this._clientOptions.errorHandler!.error(error, message, count)
    let result: ErrorHandlerResult = typeof res === 'number' ? { action: res } : defaultValue(res, { action: ErrorAction.Shutdown })
    const showNotification = result.handled === true ? false : 'force'
    if (result.action === ErrorAction.Shutdown) {
      const msg = result.message ?? `Client ${this._name}: connection to server is erroring.\n${error.message}\nShutting down server.`
      this.error(msg, error, showNotification)
      return this.stop()
    } else {
      const msg = result.message ?? `Client ${this._name}: connection to server is erroring.\n${error.message}`
      this.error(msg, error, showNotification)
    }
  }

  private hookConfigurationChanged(): void {
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(this._id)) {
        this.refreshTrace(true)
      }
    }, null, this._listeners)
  }

  private refreshTrace(sendNotification: boolean): void {
    let config = workspace.getConfiguration(this._id, null)
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
    this.changeTrace(trace, traceFormat, sendNotification)
  }

  private changeTrace(trace: Trace, traceFormat: TraceFormat, sendNotification = true): void {
    this._trace = trace
    this._traceFormat = traceFormat
    if (this._connection && (this.$state === ClientState.Running || this.$state === ClientState.Starting)) {
      this._connection.trace(this._trace, this._tracer, {
        sendNotification,
        traceFormat: this._traceFormat
      }).catch(error => {
        this.error(`Updating trace failed with error`, error, false)
      })
    }
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
  public getFeature(request: typeof FoldingRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<FoldingRangeProviderShape>
  public getFeature(request: typeof ImplementationRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<ImplementationProvider>
  public getFeature(request: typeof SelectionRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SelectionRangeProvider>
  public getFeature(request: typeof TypeDefinitionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<TypeDefinitionProvider>
  public getFeature(request: typeof CallHierarchyPrepareRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CallHierarchyProvider>
  public getFeature(request: typeof SemanticTokensRegistrationType.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SemanticTokensProviderShape>
  public getFeature(request: typeof LinkedEditingRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<LinkedEditingRangeProvider>
  public getFeature(request: typeof TypeHierarchyPrepareRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<TypeHierarchyProvider>
  public getFeature(request: typeof InlineCompletionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<InlineCompletionItemProvider>
  public getFeature(request: typeof InlineValueRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<InlineValueProviderShape>
  public getFeature(request: typeof InlayHintRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<InlayHintsProviderShape>
  public getFeature(request: typeof TextDocumentContentRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & WorkspaceProviderFeature<TextDocumentContentProviderShape>
  public getFeature(request: typeof WorkspaceSymbolRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & WorkspaceProviderFeature<WorkspaceSymbolProvider>
  public getFeature(request: typeof DocumentDiagnosticRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DiagnosticProviderShape> & DiagnosticFeatureShape
  public getFeature(request: string): DynamicFeature<any> | undefined {
    return this._dynamicFeatures.get(request)
  }

  protected registerBuiltinFeatures() {
    this.registerFeature(new SyncConfigurationFeature(this), 'configuration')
    this._didOpenTextDocumentFeature = new DidOpenTextDocumentFeature(this, this._syncedDocuments)
    this.registerFeature(this._didOpenTextDocumentFeature, 'document')
    this.registerFeature(new DidChangeTextDocumentFeature(this), 'document')
    this.registerFeature(new DidCloseTextDocumentFeature(this, this._syncedDocuments), 'document')
    this.registerFeature(new WillSaveFeature(this), 'willSave')
    this.registerFeature(new WillSaveWaitUntilFeature(this), 'willSaveWaitUntil')
    this.registerFeature(new DidSaveTextDocumentFeature(this), 'didSave')
    this.registerFeature(new FileSystemWatcherFeature(this, this.notifyFileEvent.bind(this)), 'fileSystemWatcher')
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
    this.registerFeature(new InlineCompletionItemFeature(this), 'inlineCompletion')
    this.registerFeature(new TextDocumentContentFeature(this), 'textDocumentContent')
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
    workspaceEdit.metadataSupport = true
    workspaceEdit.snippetEditSupport = true

    const diagnostics = ensure(ensure(result, 'textDocument')!, 'publishDiagnostics')!
    diagnostics.relatedInformation = true
    diagnostics.versionSupport = true
    diagnostics.tagSupport = { valueSet: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated] }
    diagnostics.codeDescriptionSupport = true
    diagnostics.dataSupport = true

    const textDocumentFilter = ensure(ensure(result, 'textDocument')!, 'filters')!
    textDocumentFilter.relativePatternSupport = true

    const windowCapabilities = ensure(result, 'window')!
    const showMessage = ensure(windowCapabilities, 'showMessage')!
    showMessage.messageActionItem = { additionalPropertiesSupport: true }
    const showDocument = ensure(windowCapabilities, 'showDocument')!
    showDocument.support = true

    const generalCapabilities = ensure(result, 'general')!
    generalCapabilities.staleRequestSupport = {
      cancel: true,
      retryOnContentModified: Array.from(BaseLanguageClient.RequestsToCancelOnContentModified)
    }
    generalCapabilities.regularExpressions = { engine: 'ECMAScript', version: 'ES2020' }
    generalCapabilities.markdown = { parser: 'marked', version: '7.0.5' }
    generalCapabilities.positionEncodings = ['utf-16']
    // Added in 3.17.0
    if (this._clientOptions.markdown.supportHtml) {
      generalCapabilities.markdown.allowedTags = ['ul', 'li', 'p', 'code', 'blockquote', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'em', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'del', 'a', 'strong', 'br', 'span']
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

  private handleRegistrationRequest(params: RegistrationParams): Promise<void> {
    if (this.clientOptions.disableDynamicRegister) return
    const middleware = this.clientOptions.middleware.handleRegisterCapability
    if (middleware) {
      return middleware(params, nextParams => this.doRegisterCapability(nextParams))
    } else {
      return this.doRegisterCapability(params)
    }
  }

  private async doRegisterCapability(params: RegistrationParams): Promise<void> {
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
        this.error(`No feature implementation for "${registration.method}" found. Registration failed.`, undefined, false)
        return
      }
      const options = defaultValue(registration.registerOptions, {})
      options.documentSelector = options.documentSelector ?? this._clientOptions.documentSelector
      const data: RegistrationData<any> = {
        id: registration.id,
        registerOptions: options
      }
      feature.register(data)
    }
  }

  private handleUnregistrationRequest(params: UnregistrationParams): Promise<void> {
    const middleware = this._clientOptions.middleware.handleUnregisterCapability
    if (middleware) {
      return middleware(params, nextParams => this.doUnregisterCapability(nextParams))
    } else {
      return this.doUnregisterCapability(params)
    }
  }

  private async doUnregisterCapability(params: UnregistrationParams): Promise<void> {
    for (const unregistration of params.unregisterations) {
      if (this._ignoredRegistrations.has(unregistration.id)) {
        continue
      }
      const feature = this._dynamicFeatures.get(unregistration.method)
      if (feature) feature.unregister(unregistration.id)
    }
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

  private setDiagnostics(uri: string, diagnostics: Diagnostic[] | undefined) {
    if (!this._diagnostics) return
    this._diagnostics.set(uri, diagnostics)
  }

  private doHandleApplyWorkspaceEdit(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> {
    return workspace.applyEdit(params.edit).then(applied => {
      return { applied }
    })
  }

  private async handleApplyWorkspaceEdit(params: ApplyWorkspaceEditParams): Promise<ApplyWorkspaceEditResult> {
    const middleware = this.clientOptions.middleware.workspace?.handleApplyEdit
    if (middleware) {
      try {
        let resultOrError = await Promise.resolve(middleware(params, nextParams => this.doHandleApplyWorkspaceEdit(nextParams)))
        if (resultOrError instanceof ResponseError) {
          throw resultOrError
        }
      } catch (error) {
        this.error(`Error on apply workspace edit`, error, false)
        return { applied: false }
      }
    } else {
      return this.doHandleApplyWorkspaceEdit(params)
    }
  }

  private static RequestsToCancelOnContentModified: Set<string> = new Set([
    InlayHintRequest.method,
    SemanticTokensRequest.method,
    SemanticTokensRangeRequest.method,
    SemanticTokensDeltaRequest.method
  ])

  public handleFailedRequest<T, P extends { method: string }>(type: P, token: CancellationToken | undefined, error: any, defaultValue: T, showNotification = true): T {
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
    this.error(`Request ${type.method} failed.`, error, showNotification)
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

  /**
   * Return extension name or id.
   */
  public getExtensionName(): string {
    if (this.__extensionName) return this.__extensionName
    let name = parseExtensionName(toText(this['stack']))
    if (name && name !== 'coc.nvim') {
      this.__extensionName = name
      return name
    }
    return this._id
  }

  /**
   * Add __extensionName property to provider
   */
  public attachExtensionName<T extends object>(provider: T): void {
    if (!provider.hasOwnProperty('__extensionName')) {
      Object.defineProperty(provider, '__extensionName', {
        get: () => this.getExtensionName(),
        enumerable: true
      })
    }
  }
}

const ProposedFeatures = {
  createAll: (_client: BaseLanguageClient): (StaticFeature | DynamicFeature<any>)[] => {
    let result: (StaticFeature | DynamicFeature<any>)[] = []
    return result
  }
}
