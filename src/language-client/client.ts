/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/* eslint-disable */
import path from 'path'
import { ApplyWorkspaceEditParams, CompletionItemTag, ApplyWorkspaceEditRequest, ApplyWorkspaceEditResponse, CancellationToken, ClientCapabilities, CodeAction, CodeActionContext, CodeActionKind, CodeActionOptions, CodeActionParams, CodeActionRegistrationOptions, CodeActionRequest, CodeLens, CodeLensOptions, CodeLensRegistrationOptions, CodeLensRequest, CodeLensResolveRequest, Command, CompletionContext, CompletionItem, CompletionItemKind, CompletionList, CompletionOptions, CompletionRegistrationOptions, CompletionRequest, CompletionResolveRequest, createProtocolConnection, DeclarationRequest, Definition, DefinitionOptions, DefinitionRegistrationOptions, DefinitionRequest, Diagnostic, DiagnosticSeverity, DiagnosticTag, DidChangeConfigurationNotification, DidChangeConfigurationParams, DidChangeConfigurationRegistrationOptions, DidChangeTextDocumentNotification, DidChangeTextDocumentParams, DidChangeWatchedFilesNotification, DidChangeWatchedFilesParams, DidChangeWatchedFilesRegistrationOptions, DidCloseTextDocumentNotification, DidCloseTextDocumentParams, DidOpenTextDocumentNotification, DidOpenTextDocumentParams, DidSaveTextDocumentNotification, DidSaveTextDocumentParams, Disposable, DocumentColorRequest, DocumentFormattingOptions, DocumentFormattingParams, DocumentFormattingRequest, DocumentHighlight, DocumentHighlightOptions, DocumentHighlightRegistrationOptions, DocumentHighlightRequest, DocumentLink, DocumentLinkOptions, DocumentLinkRegistrationOptions, DocumentLinkRequest, DocumentLinkResolveRequest, DocumentOnTypeFormattingOptions, DocumentOnTypeFormattingParams, DocumentOnTypeFormattingRegistrationOptions, DocumentOnTypeFormattingRequest, DocumentRangeFormattingOptions, DocumentRangeFormattingParams, DocumentRangeFormattingRegistrationOptions, DocumentRangeFormattingRequest, DocumentSelector, DocumentSymbol, DocumentSymbolOptions, DocumentSymbolRegistrationOptions, DocumentSymbolRequest, Emitter, ErrorCodes, Event, ExecuteCommandParams, ExecuteCommandRegistrationOptions, ExecuteCommandRequest, ExitNotification, FailureHandlingKind, FileChangeType, FileEvent, FoldingRangeRequest, FormattingOptions, GenericNotificationHandler, GenericRequestHandler, Hover, HoverOptions, HoverRegistrationOptions, HoverRequest, ImplementationRequest, InitializedNotification, InitializeError, InitializeParams, InitializeRequest, InitializeResult, Location, Logger, LogMessageNotification, LogMessageParams, MarkupKind, Message, MessageReader, MessageType, MessageWriter, NotificationHandler, NotificationHandler0, NotificationType, NotificationType0, Position, PrepareRenameRequest, ProgressToken, ProgressType, Proposed, PublishDiagnosticsNotification, PublishDiagnosticsParams, Range, ReferenceOptions, ReferenceRegistrationOptions, ReferencesRequest, RegistrationParams, RegistrationRequest, RenameOptions, RenameParams, RenameRegistrationOptions, RenameRequest, RequestHandler, RequestHandler0, RequestType, RequestType0, ResourceOperationKind, ResponseError, RPCMessageType, SelectionRangeRequest, ServerCapabilities, ShowMessageNotification, ShowMessageParams, ShowMessageRequest, ShutdownRequest, SignatureHelp, SignatureHelpOptions, SignatureHelpRegistrationOptions, SignatureHelpRequest, StaticRegistrationOptions, SymbolInformation, SymbolKind, SymbolTag, TelemetryEventNotification, TextDocumentChangeRegistrationOptions, TextDocumentEdit, TextDocumentPositionParams, TextDocumentRegistrationOptions, TextDocumentSaveRegistrationOptions, TextDocumentSyncKind, TextDocumentSyncOptions, TextEdit, Trace, TraceFormat, TraceOptions, Tracer, TypeDefinitionRequest, UnregistrationParams, UnregistrationRequest, WatchKind, WillSaveTextDocumentNotification, WillSaveTextDocumentParams, WillSaveTextDocumentWaitUntilRequest, WorkDoneProgressOptions, WorkspaceEdit, WorkspaceFolder, WorkspaceSymbolRegistrationOptions, WorkspaceSymbolRequest, SignatureHelpContext, WorkDoneProgressBegin, WorkDoneProgressEnd, WorkDoneProgressReport, WorkDoneProgress, DefinitionLink } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import commands from '../commands'
import languages from '../languages'
import FileWatcher from '../model/fileSystemWatcher'
import { CodeActionProvider, CodeLensProvider, CompletionItemProvider, DeclarationProvider, DefinitionProvider, DocumentColorProvider, DocumentFormattingEditProvider, DocumentHighlightProvider, DocumentLinkProvider, DocumentRangeFormattingEditProvider, DocumentSymbolProvider, FoldingRangeProvider, HoverProvider, ImplementationProvider, OnTypeFormattingEditProvider, ProviderResult, ReferenceProvider, RenameProvider, SelectionRangeProvider, SignatureHelpProvider, TypeDefinitionProvider, WorkspaceSymbolProvider } from '../provider'
import { DiagnosticCollection, MessageItem, OutputChannel, TextDocumentWillSaveEvent, Thenable } from '../types'
import { resolveRoot } from '../util/fs'
import { TextDocument } from 'vscode-languageserver-textdocument'
import * as Is from '../util/is'
import { omit } from '../util/lodash'
import window from '../window'
import workspace from '../workspace'
import { ColorProviderMiddleware } from './colorProvider'
import { ConfigurationWorkspaceMiddleware } from './configuration'
import { DeclarationMiddleware } from './declaration'
import { FoldingRangeProviderMiddleware } from './foldingRange'
import { ImplementationMiddleware } from './implementation'
import { ProgressPart } from './progressPart'
import { SelectionRangeProviderMiddleware } from './selectionRange'
import { TypeDefinitionMiddleware } from './typeDefinition'
import { Delayer } from './utils/async'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'
import { WorkspaceFolderWorkspaceMiddleware } from './workspaceFolders'

const logger = require('../util/logger')('language-client-client')

interface IConnection {
  listen(): void

  sendRequest<R, E, RO>(
    type: RequestType0<R, E, RO>,
    token?: CancellationToken
  ): Promise<R>
  sendRequest<P, R, E, RO>(
    type: RequestType<P, R, E, RO>,
    params: P,
    token?: CancellationToken
  ): Promise<R>
  sendRequest<R>(method: string, token?: CancellationToken): Promise<R>
  sendRequest<R>(
    method: string,
    param: any,
    token?: CancellationToken
  ): Promise<R>
  sendRequest<R>(type: string | RPCMessageType, ...params: any[]): Promise<R>

  onRequest<R, E, RO>(
    type: RequestType0<R, E, RO>,
    handler: RequestHandler0<R, E>
  ): void
  onRequest<P, R, E, RO>(
    type: RequestType<P, R, E, RO>,
    handler: RequestHandler<P, R, E>
  ): void
  onRequest<R, E>(method: string, handler: GenericRequestHandler<R, E>): void
  onRequest<R, E>(
    method: string | RPCMessageType,
    handler: GenericRequestHandler<R, E>
  ): void

  sendNotification<RO>(type: NotificationType0<RO>): void
  sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void
  sendNotification(method: string): void
  sendNotification(method: string, params: any): void
  sendNotification(method: string | RPCMessageType, params?: any): void

  onNotification<RO>(
    type: NotificationType0<RO>,
    handler: NotificationHandler0
  ): void
  onNotification<P, RO>(
    type: NotificationType<P, RO>,
    handler: NotificationHandler<P>
  ): void
  onNotification(method: string, handler: GenericNotificationHandler): void
  onNotification(
    method: string | RPCMessageType,
    handler: GenericNotificationHandler
  ): void

  onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable
  sendProgress<P>(type: ProgressType<P>, token: string | number, value: P): void

  trace(value: Trace, tracer: Tracer, sendNotification?: boolean): void
  trace(value: Trace, tracer: Tracer, traceOptions?: TraceOptions): void

  initialize(params: InitializeParams): Promise<InitializeResult>
  shutdown(): Promise<void>
  exit(): void

  onLogMessage(handle: NotificationHandler<LogMessageParams>): void
  onShowMessage(handler: NotificationHandler<ShowMessageParams>): void
  onTelemetry(handler: NotificationHandler<any>): void

  didChangeConfiguration(params: DidChangeConfigurationParams): void
  didChangeWatchedFiles(params: DidChangeWatchedFilesParams): void

  didOpenTextDocument(params: DidOpenTextDocumentParams): void
  didChangeTextDocument(params: DidChangeTextDocumentParams): void
  didCloseTextDocument(params: DidCloseTextDocumentParams): void
  didSaveTextDocument(params: DidSaveTextDocumentParams): void
  onDiagnostics(handler: NotificationHandler<PublishDiagnosticsParams>): void

  dispose(): void
}

class ConsoleLogger implements Logger {
  public error(message: string): void {
    logger.error(message)
  }
  public warn(message: string): void {
    logger.warn(message)
  }
  public info(message: string): void {
    logger.info(message)
  }
  public log(message: string): void {
    logger.log(message)
  }
}

export class NullLogger implements Logger {
  error(_message: string): void {
  }
  warn(_message: string): void {
  }
  info(_message: string): void {
  }
  log(_message: string): void {
  }
}

interface ConnectionErrorHandler {
  (error: Error, message: Message | undefined, count: number | undefined): void
}

interface ConnectionCloseHandler {
  (): void
}
function createConnection(
  inputStream: NodeJS.ReadableStream,
  outputStream: NodeJS.WritableStream,
  errorHandler: ConnectionErrorHandler,
  closeHandler: ConnectionCloseHandler
): IConnection
function createConnection(
  reader: MessageReader,
  writer: MessageWriter,
  errorHandler: ConnectionErrorHandler,
  closeHandler: ConnectionCloseHandler
): IConnection
function createConnection(
  input: any,
  output: any,
  errorHandler: ConnectionErrorHandler,
  closeHandler: ConnectionCloseHandler
): IConnection {
  let logger = new ConsoleLogger()
  let connection = createProtocolConnection(input, output, logger)
  connection.onError(data => {
    errorHandler(data[0], data[1], data[2])
  })
  connection.onClose(closeHandler)
  let result: IConnection = {
    listen: (): void => connection.listen(),

    sendRequest: <R>(type: string | RPCMessageType, ...params: any[]): Promise<R> =>
      connection.sendRequest(Is.string(type) ? type : type.method, ...params),
    onRequest: <R, E>(type: string | RPCMessageType, handler: GenericRequestHandler<R, E>): void =>
      connection.onRequest(Is.string(type) ? type : type.method, handler),
    sendNotification: (type: string | RPCMessageType, params?: any): void =>
      connection.sendNotification(Is.string(type) ? type : type.method, params),
    onNotification: (type: string | RPCMessageType, handler: GenericNotificationHandler): void =>
      connection.onNotification(Is.string(type) ? type : type.method, handler),
    onProgress: connection.onProgress,
    sendProgress: connection.sendProgress,

    trace: (
      value: Trace,
      tracer: Tracer,
      sendNotificationOrTraceOptions?: boolean | TraceOptions
    ): void => {
      const defaultTraceOptions: TraceOptions = {
        sendNotification: false,
        traceFormat: TraceFormat.Text
      }

      if (sendNotificationOrTraceOptions === void 0) {
        connection.trace(value, tracer, defaultTraceOptions)
      } else if (Is.boolean(sendNotificationOrTraceOptions)) {
        connection.trace(value, tracer, sendNotificationOrTraceOptions)
      } else {
        connection.trace(value, tracer, sendNotificationOrTraceOptions)
      }
    },

    initialize: (params: InitializeParams) =>
      connection.sendRequest(InitializeRequest.type, params),
    shutdown: () => connection.sendRequest(ShutdownRequest.type, undefined),
    exit: () => connection.sendNotification(ExitNotification.type),

    onLogMessage: (handler: NotificationHandler<LogMessageParams>) =>
      connection.onNotification(LogMessageNotification.type, handler),
    onShowMessage: (handler: NotificationHandler<ShowMessageParams>) =>
      connection.onNotification(ShowMessageNotification.type, handler),
    onTelemetry: (handler: NotificationHandler<any>) =>
      connection.onNotification(TelemetryEventNotification.type, handler),

    didChangeConfiguration: (params: DidChangeConfigurationParams) =>
      connection.sendNotification(
        DidChangeConfigurationNotification.type,
        params
      ),
    didChangeWatchedFiles: (params: DidChangeWatchedFilesParams) =>
      connection.sendNotification(
        DidChangeWatchedFilesNotification.type,
        params
      ),

    didOpenTextDocument: (params: DidOpenTextDocumentParams) =>
      connection.sendNotification(DidOpenTextDocumentNotification.type, params),
    didChangeTextDocument: (params: DidChangeTextDocumentParams) =>
      connection.sendNotification(
        DidChangeTextDocumentNotification.type,
        params
      ),
    didCloseTextDocument: (params: DidCloseTextDocumentParams) =>
      connection.sendNotification(
        DidCloseTextDocumentNotification.type,
        params
      ),
    didSaveTextDocument: (params: DidSaveTextDocumentParams) =>
      connection.sendNotification(DidSaveTextDocumentNotification.type, params),

    onDiagnostics: (handler: NotificationHandler<PublishDiagnosticsParams>) =>
      connection.onNotification(PublishDiagnosticsNotification.type, handler),

    dispose: () => connection.dispose()
  }

  return result
}

/**
 * An action to be performed when the connection is producing errors.
 */
export enum ErrorAction {
  /**
   * Continue running the server.
   */
  Continue = 1,
  /**
   * Shutdown the server.
   */
  Shutdown = 2
}

/**
 * An action to be performed when the connection to a server got closed.
 */
export enum CloseAction {
  /**
   * Don't restart the server. The connection stays closed.
   */
  DoNotRestart = 1,
  /**
   * Restart the server.
   */
  Restart = 2
}

/**
 * A pluggable error handler that is invoked when the connection is either
 * producing errors or got closed.
 */
export interface ErrorHandler {
  /**
   * An error has occurred while writing or reading from the connection.
   *
   * @param error - the error received
   * @param message - the message to be delivered to the server if know.
   * @param count - a count indicating how often an error is received. Will
   *  be reset if a message got successfully send or received.
   */
  error(error: Error, message: Message, count: number): ErrorAction

  /**
   * The connection to the server got closed.
   */
  closed(): CloseAction
}

class DefaultErrorHandler implements ErrorHandler {
  private restarts: number[]

  constructor(private name: string) {
    this.restarts = []
  }

  public error(_error: Error, _message: Message, count: number): ErrorAction {
    if (count && count <= 3) {
      return ErrorAction.Continue
    }
    return ErrorAction.Shutdown
  }
  public closed(): CloseAction {
    this.restarts.push(Date.now())
    if (this.restarts.length < 5) {
      return CloseAction.Restart
    } else {
      let diff = this.restarts[this.restarts.length - 1] - this.restarts[0]
      if (diff <= 3 * 60 * 1000) {
        window.showMessage(`The "${this.name}" server crashed 5 times in the last 3 minutes. The server will not be restarted.`, 'error')
        return CloseAction.DoNotRestart
      } else {
        this.restarts.shift()
        return CloseAction.Restart
      }
    }
  }
}

export interface InitializationFailedHandler {
  (error: ResponseError<InitializeError> | Error | any): boolean
}

export interface SynchronizeOptions {
  configurationSection?: string | string[]
  fileEvents?: FileWatcher | FileWatcher[]
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

export interface ProvideCompletionItemsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    context: CompletionContext,
    token: CancellationToken,
  ): ProviderResult<CompletionItem[] | CompletionList>
}

export interface ResolveCompletionItemSignature {
  (this: void, item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>
}

export interface ProvideHoverSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Hover>
}

export interface ProvideSignatureHelpSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    context: SignatureHelpContext,
    token: CancellationToken
  ): ProviderResult<SignatureHelp>
}

export interface ProvideDefinitionSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>
}

export interface ProvideReferencesSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    options: { includeDeclaration: boolean },
    token: CancellationToken
  ): ProviderResult<Location[]>
}

export interface ProvideDocumentHighlightsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<DocumentHighlight[]>
}

export interface ProvideDocumentSymbolsSignature {
  (this: void, document: TextDocument, token: CancellationToken): ProviderResult<SymbolInformation[] | DocumentSymbol[]>
}

export interface ProvideWorkspaceSymbolsSignature {
  (this: void, query: string, token: CancellationToken): ProviderResult<SymbolInformation[]>
}

export interface ProvideCodeActionsSignature {
  (
    this: void,
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): ProviderResult<(Command | CodeAction)[]>
}

export interface ResolveCodeActionSignature {
  (this: void, item: CodeAction, token: CancellationToken): ProviderResult<CodeAction>
}

export interface ProvideCodeLensesSignature {
  (this: void, document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>
}

export interface ResolveCodeLensSignature {
  (this: void, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>
}

export interface ProvideDocumentFormattingEditsSignature {
  (
    this: void,
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

export interface ProvideDocumentRangeFormattingEditsSignature {
  (
    this: void,
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

export interface ProvideOnTypeFormattingEditsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    ch: string,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

export interface PrepareRenameSignature {
  (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Range | { range: Range, placeholder: string }>
}

export interface ProvideRenameEditsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    newName: string,
    token: CancellationToken
  ): ProviderResult<WorkspaceEdit>
}

export interface ProvideDocumentLinksSignature {
  (this: void, document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]>
}

export interface ResolveDocumentLinkSignature {
  (this: void, link: DocumentLink, token: CancellationToken): ProviderResult<DocumentLink>
}

export interface ExecuteCommandSignature {
  (this: void, command: string, args: any[]): ProviderResult<any>
}

export interface NextSignature<P, R> {
  (this: void, data: P, next: (data: P) => R): R
}

export interface DidChangeConfigurationSignature {
  (this: void, sections: string[] | undefined): void
}

export interface DidChangeWatchedFileSignature {
  (this: void, event: FileEvent): void
}

export interface _WorkspaceMiddleware {
  didChangeConfiguration?: (
    this: void,
    sections: string[] | undefined,
    next: DidChangeConfigurationSignature
  ) => void
  didChangeWatchedFile?: (this: void, event: FileEvent, next: DidChangeWatchedFileSignature) => void
}

export type WorkspaceMiddleware = _WorkspaceMiddleware & ConfigurationWorkspaceMiddleware & WorkspaceFolderWorkspaceMiddleware

/**
 * The Middleware lets extensions intercept the request and notications send and received
 * from the server
 */
export interface _Middleware {
  didOpen?: NextSignature<TextDocument, void>
  didChange?: NextSignature<DidChangeTextDocumentParams, void>
  willSave?: NextSignature<TextDocumentWillSaveEvent, void>
  willSaveWaitUntil?: NextSignature<
    TextDocumentWillSaveEvent,
    Thenable<TextEdit[]>
  >
  didSave?: NextSignature<TextDocument, void>
  didClose?: NextSignature<TextDocument, void>

  handleDiagnostics?: (
    this: void,
    uri: string,
    diagnostics: Diagnostic[],
    next: HandleDiagnosticsSignature
  ) => void
  provideCompletionItem?: (
    this: void,
    document: TextDocument,
    position: Position,
    context: CompletionContext,
    token: CancellationToken,
    next: ProvideCompletionItemsSignature
  ) => ProviderResult<CompletionItem[] | CompletionList>
  resolveCompletionItem?: (
    this: void,
    item: CompletionItem,
    token: CancellationToken,
    next: ResolveCompletionItemSignature
  ) => ProviderResult<CompletionItem>
  provideHover?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideHoverSignature
  ) => ProviderResult<Hover>
  provideSignatureHelp?: (
    this: void,
    document: TextDocument,
    position: Position,
    context: SignatureHelpContext,
    token: CancellationToken,
    next: ProvideSignatureHelpSignature
  ) => ProviderResult<SignatureHelp>
  provideDefinition?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideDefinitionSignature
  ) => ProviderResult<Definition | DefinitionLink[]>
  provideReferences?: (
    this: void,
    document: TextDocument,
    position: Position,
    options: { includeDeclaration: boolean },
    token: CancellationToken,
    next: ProvideReferencesSignature
  ) => ProviderResult<Location[]>
  provideDocumentHighlights?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideDocumentHighlightsSignature
  ) => ProviderResult<DocumentHighlight[]>
  provideDocumentSymbols?: (
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideDocumentSymbolsSignature
  ) => ProviderResult<SymbolInformation[] | DocumentSymbol[]>
  provideWorkspaceSymbols?: (
    this: void,
    query: string,
    token: CancellationToken,
    next: ProvideWorkspaceSymbolsSignature
  ) => ProviderResult<SymbolInformation[]>
  provideCodeActions?: (
    this: void,
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken,
    next: ProvideCodeActionsSignature
  ) => ProviderResult<(Command | CodeAction)[]>
  handleWorkDoneProgress?: (
    this: void,
    token: ProgressToken,
    params: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd, next: HandleWorkDoneProgressSignature
  ) => void
  resolveCodeAction?: (
    this: void,
    item: CodeAction,
    token: CancellationToken,
    next: ResolveCodeActionSignature
  ) => ProviderResult<CodeAction>
  provideCodeLenses?: (
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideCodeLensesSignature
  ) => ProviderResult<CodeLens[]>
  resolveCodeLens?: (
    this: void,
    codeLens: CodeLens,
    token: CancellationToken,
    next: ResolveCodeLensSignature
  ) => ProviderResult<CodeLens>
  provideDocumentFormattingEdits?: (
    this: void,
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken,
    next: ProvideDocumentFormattingEditsSignature
  ) => ProviderResult<TextEdit[]>
  provideDocumentRangeFormattingEdits?: (
    this: void,
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken,
    next: ProvideDocumentRangeFormattingEditsSignature
  ) => ProviderResult<TextEdit[]>
  provideOnTypeFormattingEdits?: (
    this: void,
    document: TextDocument,
    position: Position,
    ch: string,
    options: FormattingOptions,
    token: CancellationToken,
    next: ProvideOnTypeFormattingEditsSignature
  ) => ProviderResult<TextEdit[]>
  prepareRename?: (
    this: void, document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: PrepareRenameSignature
  ) => ProviderResult<Range | { range: Range, placeholder: string }>
  provideRenameEdits?: (
    this: void,
    document: TextDocument,
    position: Position,
    newName: string,
    token: CancellationToken,
    next: ProvideRenameEditsSignature
  ) => ProviderResult<WorkspaceEdit>
  provideDocumentLinks?: (
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideDocumentLinksSignature
  ) => ProviderResult<DocumentLink[]>
  resolveDocumentLink?: (
    this: void,
    link: DocumentLink,
    token: CancellationToken,
    next: ResolveDocumentLinkSignature
  ) => ProviderResult<DocumentLink>
  executeCommand?: (
    this: void,
    command: string,
    args: any[],
    next: ExecuteCommandSignature
  ) => ProviderResult<any>
  workspace?: WorkspaceMiddleware
}

export type Middleware = _Middleware &
  TypeDefinitionMiddleware &
  ImplementationMiddleware &
  ColorProviderMiddleware &
  DeclarationMiddleware &
  FoldingRangeProviderMiddleware &
  SelectionRangeProviderMiddleware

export interface LanguageClientOptions {
  ignoredRootPaths?: string[]
  documentSelector?: DocumentSelector | string[]
  synchronize?: SynchronizeOptions
  diagnosticCollectionName?: string
  disableDynamicRegister?: boolean
  disableWorkspaceFolders?: boolean
  disableSnippetCompletion?: boolean
  disableDiagnostics?: boolean
  disableCompletion?: boolean
  formatterPriority?: number
  outputChannelName?: string
  outputChannel?: OutputChannel
  revealOutputChannelOn?: RevealOutputChannelOn
  /**
   * The encoding use to read stdout and stderr. Defaults
   * to 'utf8' if ommitted.
   */
  stdioEncoding?: string
  initializationOptions?: any | (() => any)
  initializationFailedHandler?: InitializationFailedHandler
  progressOnInitialization?: boolean
  errorHandler?: ErrorHandler
  middleware?: Middleware
  workspaceFolder?: WorkspaceFolder
}

interface ResolvedClientOptions {
  ignoredRootPaths?: string[]
  disableWorkspaceFolders: boolean
  disableSnippetCompletion: boolean
  disableDynamicRegister: boolean
  disableDiagnostics: boolean
  disableCompletion: boolean
  formatterPriority: number
  documentSelector?: DocumentSelector
  synchronize: SynchronizeOptions
  diagnosticCollectionName?: string
  outputChannelName: string
  revealOutputChannelOn: RevealOutputChannelOn
  stdioEncoding: string
  initializationOptions?: any | (() => any)
  initializationFailedHandler?: InitializationFailedHandler
  progressOnInitialization: boolean
  errorHandler: ErrorHandler
  middleware: Middleware
  workspaceFolder?: WorkspaceFolder
}

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

const SupportedSymbolKinds: SymbolKind[] = [
  SymbolKind.File,
  SymbolKind.Module,
  SymbolKind.Namespace,
  SymbolKind.Package,
  SymbolKind.Class,
  SymbolKind.Method,
  SymbolKind.Property,
  SymbolKind.Field,
  SymbolKind.Constructor,
  SymbolKind.Enum,
  SymbolKind.Interface,
  SymbolKind.Function,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.String,
  SymbolKind.Number,
  SymbolKind.Boolean,
  SymbolKind.Array,
  SymbolKind.Object,
  SymbolKind.Key,
  SymbolKind.Null,
  SymbolKind.EnumMember,
  SymbolKind.Struct,
  SymbolKind.Event,
  SymbolKind.Operator,
  SymbolKind.TypeParameter
]

const SupportedCompletionItemKinds: CompletionItemKind[] = [
  CompletionItemKind.Text,
  CompletionItemKind.Method,
  CompletionItemKind.Function,
  CompletionItemKind.Constructor,
  CompletionItemKind.Field,
  CompletionItemKind.Variable,
  CompletionItemKind.Class,
  CompletionItemKind.Interface,
  CompletionItemKind.Module,
  CompletionItemKind.Property,
  CompletionItemKind.Unit,
  CompletionItemKind.Value,
  CompletionItemKind.Enum,
  CompletionItemKind.Keyword,
  CompletionItemKind.Snippet,
  CompletionItemKind.Color,
  CompletionItemKind.File,
  CompletionItemKind.Reference,
  CompletionItemKind.Folder,
  CompletionItemKind.EnumMember,
  CompletionItemKind.Constant,
  CompletionItemKind.Struct,
  CompletionItemKind.Event,
  CompletionItemKind.Operator,
  CompletionItemKind.TypeParameter
]

const SupportedSymbolTags: SymbolTag[] = [
  SymbolTag.Deprecated
]

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
  if (target[key] == null) {
    target[key] = {} as any
  }
  return target[key]
}

interface ResolvedTextDocumentSyncCapabilities {
  resolvedTextDocumentSync?: TextDocumentSyncOptions
}

export interface RegistrationData<T> {
  id: string
  registerOptions: T
}

/**
 * A static feature. A static feature can't be dynamically activate via the
 * server. It is wired during the initialize sequence.
 */
export interface StaticFeature {
  /**
   * Called to fill the initialize params.
   *
   * @params the initialize params.
   */
  fillInitializeParams?: (params: InitializeParams) => void

  /**
   * Called to fill in the client capabilities this feature implements.
   *
   * @param capabilities The client capabilities to fill.
   */
  fillClientCapabilities(capabilities: ClientCapabilities): void

  /**
   * Initialize the feature. This method is called on a feature instance
   * when the client has successfully received the initalize request from
   * the server and before the client sends the initialized notification
   * to the server.
   *
   * @param capabilities the server capabilities
   * @param documentSelector the document selector pass to the client's constuctor.
   *  May be `undefined` if the client was created without a selector.
   */
  initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector | undefined
  ): void

  /**
   * Called when the client is stopped to dispose this feature. Usually a feature
   * unregisters listeners registerd hooked up with the VS Code extension host.
   */
  dispose(): void
}

export interface DynamicFeature<T> {
  /**
   * The message for which this features support dynamic activation / registration.
   */
  messages: RPCMessageType | RPCMessageType[]

  /**
   * Called to fill the initialize params.
   *
   * @params the initialize params.
   */
  fillInitializeParams?: (params: InitializeParams) => void

  /**
   * Called to fill in the client capabilities this feature implements.
   *
   * @param capabilities The client capabilities to fill.
   */
  fillClientCapabilities(capabilities: ClientCapabilities): void

  /**
   * Initialize the feature. This method is called on a feature instance
   * when the client has successfully received the initalize request from
   * the server and before the client sends the initialized notification
   * to the server.
   *
   * @param capabilities the server capabilities.
   * @param documentSelector the document selector pass to the client's constuctor.
   *  May be `undefined` if the client was created without a selector.
   */
  initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector | undefined
  ): void

  /**
   * Is called when the server send a register request for the given message.
   *
   * @param message the message to register for.
   * @param data additional registration data as defined in the protocol.
   */
  register(message: RPCMessageType, data: RegistrationData<T>): void

  /**
   * Is called when the server wants to unregister a feature.
   *
   * @param id the id used when registering the feature.
   */
  unregister(id: string): void

  /**
   * Called when the client is stopped to dispose this feature. Usually a feature
   * unregisters listeners registerd hooked up with the VS Code extension host.
   */
  dispose(): void
}

export interface NotificationFeature<T extends Function> {
  /**
   * Triggers the corresponding RPC method.
   */
  getProvider(document: TextDocument): { send: T }
}

namespace DynamicFeature {
  export function is<T>(value: any): value is DynamicFeature<T> {
    let candidate: DynamicFeature<T> = value
    return (
      candidate &&
      Is.func(candidate.register) &&
      Is.func(candidate.unregister) &&
      Is.func(candidate.dispose) &&
      candidate.messages !== void 0
    )
  }
}

interface CreateParamsSignature<E, P> {
  (data: E): P
}

abstract class DocumentNotifiactions<P, E>
  implements DynamicFeature<TextDocumentRegistrationOptions>, NotificationFeature<(data: E) => void> {
  private _listener: Disposable | undefined
  protected _selectors: Map<string, DocumentSelector> = new Map()

  public static textDocumentFilter(
    selectors: IterableIterator<DocumentSelector>,
    textDocument: TextDocument
  ): boolean {
    for (const selector of selectors) {
      if (workspace.match(selector, textDocument) > 0) {
        return true
      }
    }
    return false
  }

  constructor(
    protected _client: BaseLanguageClient,
    private _event: Event<E>,
    protected _type: NotificationType<P, TextDocumentRegistrationOptions>,
    protected _middleware: NextSignature<E, void> | undefined,
    protected _createParams: CreateParamsSignature<E, P>,
    protected _selectorFilter?: (
      selectors: IterableIterator<DocumentSelector>,
      data: E
    ) => boolean
  ) {}

  public abstract messages: RPCMessageType | RPCMessageType[]

  public abstract fillClientCapabilities(capabilities: ClientCapabilities): void

  public abstract initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector | undefined
  ): void

  public register(
    _message: RPCMessageType,
    data: RegistrationData<TextDocumentRegistrationOptions>
  ): void {
    if (!data.registerOptions.documentSelector) {
      return
    }
    if (!this._listener) {
      this._listener = this._event(this.callback, this)
    }
    this._selectors.set(data.id, data.registerOptions.documentSelector)
  }

  private callback(data: E): void {
    if (
      !this._selectorFilter ||
      this._selectorFilter(this._selectors.values(), data)
    ) {
      if (this._middleware) {
        this._middleware(data, data =>
          this._client.sendNotification(this._type, this._createParams(data))
        )
      } else {
        this._client.sendNotification(this._type, this._createParams(data))
      }
      this.notificationSent(data)
    }
  }

  protected notificationSent(_data: E): void {}

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

  public getProvider(document: TextDocument): { send: (data: E) => void } {
    for (const selector of this._selectors.values()) {
      if (workspace.match(selector, document)) {
        return {
          send: (data: E) => {
            this.callback(data)
          }
        }
      }
    }
    throw new Error(`No provider available for the given text document`)
  }
}

class DidOpenTextDocumentFeature extends DocumentNotifiactions<DidOpenTextDocumentParams, TextDocument> {
  constructor(client: BaseLanguageClient, private _syncedDocuments: Map<string, TextDocument>) {
    super(
      client,
      workspace.onDidOpenTextDocument,
      DidOpenTextDocumentNotification.type,
      client.clientOptions.middleware!.didOpen,
      (textDocument) => {
        return { textDocument: cv.convertToTextDocumentItem(textDocument) }
      },
      DocumentNotifiactions.textDocumentFilter
    )
  }

  public get messages(): typeof DidOpenTextDocumentNotification.type {
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
    if (
      documentSelector &&
      textDocumentSyncOptions &&
      textDocumentSyncOptions.openClose
    ) {
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: { documentSelector: documentSelector }
      })
    }
  }

  public register(
    message: RPCMessageType,
    data: RegistrationData<TextDocumentRegistrationOptions>
  ): void {
    super.register(message, data)
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
        let middleware = this._client.clientOptions.middleware!
        let didOpen = (textDocument: TextDocument) => {
          this._client.sendNotification(
            this._type,
            this._createParams(textDocument)
          )
        }
        if (middleware.didOpen) {
          middleware.didOpen(textDocument, didOpen)
        } else {
          didOpen(textDocument)
        }
        this._syncedDocuments.set(uri, textDocument)
      }
    })
  }

  protected notificationSent(textDocument: TextDocument): void {
    super.notificationSent(textDocument)
    this._syncedDocuments.set(textDocument.uri.toString(), textDocument)
  }
}

class DidCloseTextDocumentFeature extends DocumentNotifiactions<
  DidCloseTextDocumentParams,
  TextDocument
  > {
  constructor(
    client: BaseLanguageClient,
    private _syncedDocuments: Map<string, TextDocument>
  ) {
    super(
      client,
      workspace.onDidCloseTextDocument,
      DidCloseTextDocumentNotification.type,
      client.clientOptions.middleware!.didClose,
      (textDocument) => cv.asCloseTextDocumentParams(textDocument),
      DocumentNotifiactions.textDocumentFilter
    )
  }

  public get messages(): typeof DidCloseTextDocumentNotification.type {
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
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: { documentSelector: documentSelector }
      })
    }
  }

  protected notificationSent(textDocument: TextDocument): void {
    super.notificationSent(textDocument)
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
        let middleware = this._client.clientOptions.middleware!
        let didClose = (textDocument: TextDocument) => {
          this._client.sendNotification(
            this._type,
            this._createParams(textDocument)
          )
        }
        this._syncedDocuments.delete(textDocument.uri.toString())
        if (middleware.didClose) {
          middleware.didClose(textDocument, didClose)
        } else {
          didClose(textDocument)
        }
      }
    })
  }
}

interface DidChangeTextDocumentData {
  documentSelector: DocumentSelector
  syncKind: 0 | 1 | 2
}

class DidChangeTextDocumentFeature
  implements DynamicFeature<TextDocumentChangeRegistrationOptions>, NotificationFeature<(event: DidChangeTextDocumentParams) => void> {
  private _listener: Disposable | undefined
  private _changeData: Map<string, DidChangeTextDocumentData> = new Map<string, DidChangeTextDocumentData>()

  constructor(private _client: BaseLanguageClient) {}

  public get messages(): typeof DidChangeTextDocumentNotification.type {
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
      textDocumentSyncOptions.change !== void 0 &&
      textDocumentSyncOptions.change !== TextDocumentSyncKind.None
    ) {
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: Object.assign(
          {},
          { documentSelector: documentSelector },
          { syncKind: textDocumentSyncOptions.change }
        )
      })
    }
  }

  public register(
    _message: RPCMessageType,
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

  private callback(event: DidChangeTextDocumentParams): void {
    // Text document changes are send for dirty changes as well. We don't
    // have dirty / undirty events in the LSP so we ignore content changes
    // with length zero.
    if (event.contentChanges.length === 0) {
      return
    }
    let doc = workspace.getDocument(event.textDocument.uri)
    if (!doc) return
    let { textDocument } = doc
    for (const changeData of this._changeData.values()) {
      if (workspace.match(changeData.documentSelector, textDocument) > 0) {
        let middleware = this._client.clientOptions.middleware!
        if (changeData.syncKind === TextDocumentSyncKind.Incremental) {
          if (middleware.didChange) {
            middleware.didChange(event, () =>
              this._client.sendNotification(
                DidChangeTextDocumentNotification.type,
                omit(event, ['bufnr', 'original'])
              )
            )
          } else {
            this._client.sendNotification(
              DidChangeTextDocumentNotification.type,
              omit(event, ['bufnr', 'original'])
            )
          }
        } else if (changeData.syncKind === TextDocumentSyncKind.Full) {
          let didChange: (event: DidChangeTextDocumentParams) => void = event => {
            let { textDocument } = workspace.getDocument(event.textDocument.uri)
            this._client.sendNotification(
              DidChangeTextDocumentNotification.type,
              cv.asChangeTextDocumentParams(textDocument)
            )
          }
          if (middleware.didChange) {
            middleware.didChange(event, didChange)
          } else {
            didChange(event)
          }
        }
      }
    }
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

  public getProvider(document: TextDocument): { send: (event: DidChangeTextDocumentParams) => void } {
    for (const changeData of this._changeData.values()) {
      if (workspace.match(changeData.documentSelector, document)) {
        return {
          send: (event: DidChangeTextDocumentParams): void => {
            this.callback(event)
          }
        }
      }
    }
    throw new Error(`No provider available for the given text document`)
  }
}

class WillSaveFeature extends DocumentNotifiactions<WillSaveTextDocumentParams, TextDocumentWillSaveEvent> {
  constructor(client: BaseLanguageClient) {
    super(
      client,
      workspace.onWillSaveTextDocument,
      WillSaveTextDocumentNotification.type,
      client.clientOptions.middleware!.willSave,
      willSaveEvent => cv.asWillSaveTextDocumentParams(willSaveEvent),
      (selectors, willSaveEvent) => DocumentNotifiactions.textDocumentFilter(selectors, willSaveEvent.document)
    )
  }

  public get messages(): RPCMessageType {
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
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: { documentSelector: documentSelector }
      })
    }
  }
}

class WillSaveWaitUntilFeature implements DynamicFeature<TextDocumentRegistrationOptions> {
  private _listener: Disposable | undefined
  private _selectors: Map<string, DocumentSelector> = new Map<string, DocumentSelector>()

  constructor(private _client: BaseLanguageClient) {}

  public get messages(): RPCMessageType {
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
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: { documentSelector: documentSelector }
      })
    }
  }

  public register(
    _message: RPCMessageType,
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
    if (DocumentNotifiactions.textDocumentFilter(
      this._selectors.values(),
      event.document)) {
      let middleware = this._client.clientOptions.middleware!
      let willSaveWaitUntil = (event: TextDocumentWillSaveEvent): Thenable<TextEdit[]> => {
        return this._client
          .sendRequest(
            WillSaveTextDocumentWaitUntilRequest.type,
            cv.asWillSaveTextDocumentParams(event)
          )
          .then(edits => {
            return edits ? edits : []
          }, e => {
            window.showMessage(`Error on willSaveWaitUntil: ${e}`, 'error')
            logger.error(e)
            return []
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

class DidSaveTextDocumentFeature extends DocumentNotifiactions<
  DidSaveTextDocumentParams,
  TextDocument
  > {
  private _includeText: boolean

  constructor(client: BaseLanguageClient) {
    super(
      client,
      workspace.onDidSaveTextDocument,
      DidSaveTextDocumentNotification.type,
      client.clientOptions.middleware!.didSave,
      textDocument =>
        cv.asSaveTextDocumentParams(
          textDocument,
          this._includeText
        ),
      DocumentNotifiactions.textDocumentFilter
    )
  }

  public get messages(): RPCMessageType {
    return DidSaveTextDocumentNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'textDocument')!,
      'synchronization'
    )!.didSave = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    let textDocumentSyncOptions = (capabilities as ResolvedTextDocumentSyncCapabilities).resolvedTextDocumentSync
    if (
      documentSelector &&
      textDocumentSyncOptions &&
      textDocumentSyncOptions.save
    ) {
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: Object.assign(
          {},
          { documentSelector: documentSelector },
          { includeText: !!textDocumentSyncOptions.save.includeText }
        )
      })
    }
  }

  public register(
    method: RPCMessageType,
    data: RegistrationData<TextDocumentSaveRegistrationOptions>
  ): void {
    this._includeText = !!data.registerOptions.includeText
    super.register(method, data)
  }
}

class FileSystemWatcherFeature
  implements DynamicFeature<DidChangeWatchedFilesRegistrationOptions> {
  private _watchers: Map<string, Disposable[]> = new Map<string, Disposable[]>()

  constructor(
    _client: BaseLanguageClient,
    private _notifyFileEvent: (event: FileEvent) => void
  ) {}

  public get messages(): RPCMessageType {
    return DidChangeWatchedFilesNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'workspace')!,
      'didChangeWatchedFiles'
    )!.dynamicRegistration = true
  }

  public initialize(
    _capabilities: ServerCapabilities,
    _documentSelector: DocumentSelector
  ): void {}

  public register(
    _method: RPCMessageType,
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
      let watchCreate: boolean = true,
        watchChange: boolean = true,
        watchDelete: boolean = true
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

  public registerRaw(id: string, fileSystemWatchers: FileWatcher[]) {
    let disposables: Disposable[] = []
    for (let fileSystemWatcher of fileSystemWatchers) {
      disposables.push(fileSystemWatcher)
      this.hookListeners(fileSystemWatcher, true, true, true, disposables)
    }
    this._watchers.set(id, disposables)
  }

  private hookListeners(
    fileSystemWatcher: FileWatcher,
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

interface TextDocumentFeatureRegistration<RO, PR> {
  disposable: Disposable
  data: RegistrationData<RO>
  provider: PR
}

export interface TextDocumentProviderFeature<T> {
  /**
   * Triggers the corresponding RPC method.
   */
  getProvider(textDocument: TextDocument): T
}

export abstract class TextDocumentFeature<
  PO, RO extends TextDocumentRegistrationOptions & PO, PR
  > implements DynamicFeature<RO> {
  private _registrations: Map<string, TextDocumentFeatureRegistration<RO, PR>> = new Map()

  constructor(
    protected _client: BaseLanguageClient,
    private _message: RPCMessageType
  ) {}

  public get messages(): RPCMessageType {
    return this._message
  }

  public abstract fillClientCapabilities(capabilities: ClientCapabilities): void

  public abstract initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void

  public register(message: RPCMessageType, data: RegistrationData<RO>): void {
    if (message.method !== this.messages.method) {
      throw new Error(
        `Register called on wrong feature. Requested ${message.method
        } but reached feature ${this.messages.method}`
      )
    }
    if (!data.registerOptions.documentSelector) {
      return
    }
    let registration = this.registerLanguageProvider(data.registerOptions)
    this._registrations.set(data.id, { disposable: registration[0], data, provider: registration[1] })
  }

  protected abstract registerLanguageProvider(options: RO): [Disposable, PR]

  public unregister(id: string): void {
    let registration = this._registrations.get(id)
    if (registration) {
      registration.disposable.dispose()
    }
  }

  public dispose(): void {
    this._registrations.forEach(value => {
      value.disposable.dispose()
    })
    this._registrations.clear()
  }

  protected getRegistration(documentSelector: DocumentSelector | undefined, capability: undefined | PO | (RO & StaticRegistrationOptions)): [string | undefined, (RO & { documentSelector: DocumentSelector }) | undefined] {
    if (!capability) {
      return [undefined, undefined]
    } else if (TextDocumentRegistrationOptions.is(capability)) {
      const id = StaticRegistrationOptions.hasId(capability) ? capability.id : UUID.generateUuid()
      const selector = capability.documentSelector || documentSelector
      if (selector) {
        return [id, Object.assign({}, capability, { documentSelector: selector })]
      }
    } else if (Is.boolean(capability) && capability === true || WorkDoneProgressOptions.is(capability)) {
      if (!documentSelector) {
        return [undefined, undefined]
      }
      let options: RO & { documentSelector: DocumentSelector } = (Is.boolean(capability) && capability === true ? { documentSelector } : Object.assign({}, capability, { documentSelector })) as any
      return [UUID.generateUuid(), options]
    }
    return [undefined, undefined]
  }

  protected getRegistrationOptions(documentSelector: DocumentSelector | undefined, capability: undefined | PO): (RO & { documentSelector: DocumentSelector }) | undefined {
    if (!documentSelector || !capability) {
      return undefined
    }
    return (Is.boolean(capability) && capability === true ? { documentSelector } : Object.assign({}, capability, { documentSelector })) as RO & { documentSelector: DocumentSelector }
  }

  public getProvider(textDocument: TextDocument): PR {
    for (const registration of this._registrations.values()) {
      let selector = registration.data.registerOptions.documentSelector
      if (selector !== null && workspace.match(selector, textDocument) > 0) {
        return registration.provider
      }
    }
    throw new Error(`The feature has no registration for the provided text document ${textDocument.uri.toString()}`)
  }
}

export interface WorkspaceProviderFeature<PR> {
  getProviders(): PR[]
}

abstract class WorkspaceFeature<RO, PR> implements DynamicFeature<RO> {
  protected _registrations: Map<string, Disposable> = new Map()

  constructor(
    protected _client: BaseLanguageClient,
    private _message: RPCMessageType
  ) {}

  public get messages(): RPCMessageType {
    return this._message
  }

  public abstract fillClientCapabilities(capabilities: ClientCapabilities): void

  public abstract initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector | undefined
  ): void

  public register(message: RPCMessageType, data: RegistrationData<RO>): void {
    if (message.method !== this.messages.method) {
      throw new Error(`Register called on wrong feature. Requested ${message.method} but reached feature ${this.messages.method}`)
    }
    const registration = this.registerLanguageProvider(data.registerOptions)
    this._registrations.set(data.id, registration)
  }

  protected abstract registerLanguageProvider(options: RO): Disposable

  public unregister(id: string): void {
    const registration = this._registrations.get(id)
    if (registration) registration.dispose()
  }

  public dispose(): void {
    this._registrations.forEach(value => {
      value.dispose()
    })
    this._registrations.clear()
  }
}

export interface ProvideResolveFeature<T1 extends Function, T2 extends Function> {
  provide: T1
  resolve: T2
}

class CompletionItemFeature extends TextDocumentFeature<CompletionOptions, CompletionRegistrationOptions, CompletionItemProvider> {
  private index: number
  constructor(client: BaseLanguageClient) {
    super(client, CompletionRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let snippetSupport = this._client.clientOptions.disableSnippetCompletion !== true
    let completion = ensure(ensure(capabilites, 'textDocument')!, 'completion')!
    completion.dynamicRegistration = true
    completion.contextSupport = true
    completion.completionItem = {
      snippetSupport,
      commitCharactersSupport: true,
      documentationFormat: this._client.supporedMarkupKind,
      deprecatedSupport: true,
      preselectSupport: true,
      tagSupport: { valueSet: [CompletionItemTag.Deprecated] },
    }
    completion.completionItemKind = { valueSet: SupportedCompletionItemKinds }
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    this.index = 0
    const options = this.getRegistrationOptions(documentSelector, capabilities.completionProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: CompletionRegistrationOptions): [Disposable, CompletionItemProvider] {
    let triggerCharacters = options.triggerCharacters || []
    let allCommitCharacters = options.allCommitCharacters || []
    let priority = (options as any).priority as number
    this.index = this.index + 1
    const provider: CompletionItemProvider = {
      provideCompletionItems: (document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<CompletionList | CompletionItem[]> => {
        const client = this._client
        const middleware = this._client.clientOptions.middleware!
        const provideCompletionItems: ProvideCompletionItemsSignature = (document, position, context, token) => {
          return client.sendRequest(
            CompletionRequest.type,
            cv.asCompletionParams(document, position, context),
            token
          ).then(result => result, error => {
            client.logFailedRequest(CompletionRequest.type, error)
            return Promise.resolve([])
          })
        }

        return middleware.provideCompletionItem
          ? middleware.provideCompletionItem(document, position, context, token, provideCompletionItems)
          : provideCompletionItems(document, position, context, token)
      },
      resolveCompletionItem: options.resolveProvider
        ? (item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> => {
          const client = this._client
          const middleware = this._client.clientOptions.middleware!
          const resolveCompletionItem: ResolveCompletionItemSignature = (item, token) => {
            return client.sendRequest(
              CompletionResolveRequest.type,
              item,
              token
            ).then(res => res, error => {
              client.logFailedRequest(CompletionResolveRequest.type, error)
              return Promise.resolve(item)
            })
          }

          return middleware.resolveCompletionItem
            ? middleware.resolveCompletionItem(item, token, resolveCompletionItem)
            : resolveCompletionItem(item, token)
        }
        : undefined
    }

    const languageIds = cv.asLanguageIds(options.documentSelector!)
    const disposable = languages.registerCompletionItemProvider(
      this._client.id + '-' + this.index,
      'LS',
      languageIds,
      provider,
      triggerCharacters,
      priority,
      allCommitCharacters)
    return [disposable, provider]
  }
}

class HoverFeature extends TextDocumentFeature<
  boolean | HoverOptions, HoverRegistrationOptions, HoverProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, HoverRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    const hoverCapability = ensure(
      ensure(capabilites, 'textDocument')!,
      'hover'
    )!
    hoverCapability.dynamicRegistration = true
    hoverCapability.contentFormat = this._client.supporedMarkupKind
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.hoverProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: HoverRegistrationOptions
  ): [Disposable, HoverProvider] {
    const provider: HoverProvider = {
      provideHover: (document, position, token) => {
        const client = this._client
        const provideHover: ProvideHoverSignature = (document, position, token) => {
          return client.sendRequest(
            HoverRequest.type,
            cv.asTextDocumentPositionParams(document, position),
            token
          ).then(res => res, error => {
            client.logFailedRequest(HoverRequest.type, error)
            return Promise.resolve(null)
          })
        }

        const middleware = client.clientOptions.middleware!
        return middleware.provideHover
          ? middleware.provideHover(document, position, token, provideHover)
          : provideHover(document, position, token)
      }
    }

    return [languages.registerHoverProvider(options.documentSelector!, provider), provider]
  }
}

class SignatureHelpFeature extends TextDocumentFeature<
  SignatureHelpOptions, SignatureHelpRegistrationOptions, SignatureHelpProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, SignatureHelpRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let config = ensure(ensure(capabilites, 'textDocument')!, 'signatureHelp')!
    config.dynamicRegistration = true
    config.contextSupport = true
    config.signatureInformation = {
      documentationFormat: this._client.supporedMarkupKind,
      activeParameterSupport: true,
      parameterInformation: {
        labelOffsetSupport: true
      }
    } as any
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.signatureHelpProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: SignatureHelpRegistrationOptions
  ): [Disposable, SignatureHelpProvider] {
    const provider: SignatureHelpProvider = {
      provideSignatureHelp: (document, position, token, context) => {
        const client = this._client
        const providerSignatureHelp: ProvideSignatureHelpSignature = (document, position, context, token) => {
          return client.sendRequest(
            SignatureHelpRequest.type,
            cv.asSignatureHelpParams(document, position, context),
            token
          ).then(res => res, error => {
            client.logFailedRequest(SignatureHelpRequest.type, error)
            return Promise.resolve(null)
          }
          )
        }

        const middleware = client.clientOptions.middleware!
        return middleware.provideSignatureHelp
          ? middleware.provideSignatureHelp(document, position, context, token, providerSignatureHelp)
          : providerSignatureHelp(document, position, context, token)
      }
    }

    const triggerCharacters = options.triggerCharacters || []
    const disposable = languages.registerSignatureHelpProvider(options.documentSelector!, provider, triggerCharacters)
    return [disposable, provider]
  }
}

class DefinitionFeature extends TextDocumentFeature<
  boolean | DefinitionOptions, DefinitionRegistrationOptions, DefinitionProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, DefinitionRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let definitionSupport = ensure(ensure(capabilites, 'textDocument')!, 'definition')!
    definitionSupport.dynamicRegistration = true
    // definitionSupport.linkSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.definitionProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: DefinitionRegistrationOptions
  ): [Disposable, DefinitionProvider] {
    const provider: DefinitionProvider = {
      provideDefinition: (document, position, token) => {
        const client = this._client
        const provideDefinition: ProvideDefinitionSignature = (document, position, token) => {
          return client.sendRequest(
            DefinitionRequest.type,
            cv.asTextDocumentPositionParams(document, position),
            token
          ).then(res => res, error => {
            client.logFailedRequest(DefinitionRequest.type, error)
            return Promise.resolve(null)
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideDefinition
          ? middleware.provideDefinition(document, position, token, provideDefinition)
          : provideDefinition(document, position, token)
      }
    }

    return [languages.registerDefinitionProvider(options.documentSelector!, provider), provider]
  }
}

class ReferencesFeature extends TextDocumentFeature<
  boolean | ReferenceOptions, ReferenceRegistrationOptions, ReferenceProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, ReferencesRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(
      ensure(capabilites, 'textDocument')!,
      'references'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.referencesProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, ReferenceProvider] {
    const provider: ReferenceProvider = {
      provideReferences: (document, position, options, token) => {
        const client = this._client
        const _providerReferences: ProvideReferencesSignature = (document, position, options, token) => {
          return client.sendRequest(
            ReferencesRequest.type,
            cv.asReferenceParams(document, position, options),
            token
          ).then(res => res, error => {
            client.logFailedRequest(ReferencesRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideReferences
          ? middleware.provideReferences(document, position, options, token, _providerReferences)
          : _providerReferences(document, position, options, token)
      }
    }
    return [languages.registerReferencesProvider(options.documentSelector!, provider), provider]
  }
}

class DocumentHighlightFeature extends TextDocumentFeature<
  boolean | DocumentHighlightOptions, DocumentHighlightRegistrationOptions, DocumentHighlightProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, DocumentHighlightRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(
      ensure(capabilites, 'textDocument')!,
      'documentHighlight'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentHighlightProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentHighlightProvider] {
    const provider: DocumentHighlightProvider = {
      provideDocumentHighlights: (document, position, token) => {
        const client = this._client
        const _provideDocumentHighlights: ProvideDocumentHighlightsSignature = (document, position, token) => {
          return client.sendRequest(
            DocumentHighlightRequest.type,
            cv.asTextDocumentPositionParams(document, position),
            token
          ).then(res => res, error => {
            client.logFailedRequest(DocumentHighlightRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideDocumentHighlights
          ? middleware.provideDocumentHighlights(document, position, token, _provideDocumentHighlights)
          : _provideDocumentHighlights(document, position, token)
      }
    }
    return [languages.registerDocumentHighlightProvider(options.documentSelector!, provider), provider]
  }
}

class DocumentSymbolFeature extends TextDocumentFeature<
  boolean | DocumentSymbolOptions, DocumentSymbolRegistrationOptions, DocumentSymbolProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, DocumentSymbolRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let symbolCapabilities = ensure(ensure(capabilites, 'textDocument')!, 'documentSymbol')! as any
    symbolCapabilities.dynamicRegistration = true
    symbolCapabilities.symbolKind = {
      valueSet: SupportedSymbolKinds
    }
    symbolCapabilities.hierarchicalDocumentSymbolSupport = true
    symbolCapabilities.tagSupport = {
      valueSet: SupportedSymbolTags
    }
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentSymbolProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentSymbolProvider] {
    const provider: DocumentSymbolProvider = {
      provideDocumentSymbols: (document, token) => {
        const client = this._client
        const _provideDocumentSymbols: ProvideDocumentSymbolsSignature = (document, token) => {
          return client.sendRequest(
            DocumentSymbolRequest.type,
            cv.asDocumentSymbolParams(document),
            token
          ).then(
            (data) => {
              if (data === null) {
                return undefined
              }
              if (data.length === 0) {
                return []
              } else {
                let element = data[0]
                if (DocumentSymbol.is(element)) {
                  return data as DocumentSymbol[]
                } else {
                  return data as SymbolInformation[]
                }
              }
            },
            (error) => {
              client.logFailedRequest(DocumentSymbolRequest.type, error)
              return Promise.resolve([])
            }
          )
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideDocumentSymbols
          ? middleware.provideDocumentSymbols(document, token, _provideDocumentSymbols)
          : _provideDocumentSymbols(document, token)
      }
    }
    return [languages.registerDocumentSymbolProvider(options.documentSelector!, provider), provider]
  }
}

class WorkspaceSymbolFeature extends WorkspaceFeature<WorkspaceSymbolRegistrationOptions, WorkspaceSymbolProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, WorkspaceSymbolRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let symbolCapabilities = ensure(
      ensure(capabilites, 'workspace')!,
      'symbol'
    )! as any
    symbolCapabilities.dynamicRegistration = true
    symbolCapabilities.symbolKind = {
      valueSet: SupportedSymbolKinds
    }
    symbolCapabilities.tagSupport = {
      valueSet: SupportedSymbolTags
    }
  }

  public initialize(
    capabilities: ServerCapabilities,
  ): void {
    if (!capabilities.workspaceSymbolProvider) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: capabilities.workspaceSymbolProvider === true ? { workDoneProgress: false } : capabilities.workspaceSymbolProvider
    })
  }

  protected registerLanguageProvider(_options: WorkspaceSymbolRegistrationOptions): Disposable {
    const provider: WorkspaceSymbolProvider = {
      provideWorkspaceSymbols: (query, token) => {
        const client = this._client
        const provideWorkspaceSymbols: ProvideWorkspaceSymbolsSignature = (query, token) => {
          return client.sendRequest(WorkspaceSymbolRequest.type, { query }, token).then(
            res => res,
            error => {
              client.logFailedRequest(WorkspaceSymbolRequest.type, error)
              return Promise.resolve([])
            })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideWorkspaceSymbols
          ? middleware.provideWorkspaceSymbols(query, token, provideWorkspaceSymbols)
          : provideWorkspaceSymbols(query, token)
      }
    }
    return languages.registerWorkspaceSymbolProvider(provider)
  }
}

class CodeActionFeature extends TextDocumentFeature<boolean | CodeActionOptions, CodeActionRegistrationOptions, CodeActionProvider> {
  constructor(client: BaseLanguageClient) {
    super(client, CodeActionRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    const cap = ensure(ensure(capabilites, 'textDocument')!, 'codeAction')!
    cap.dynamicRegistration = true
    cap.isPreferredSupport = true
    cap.codeActionLiteralSupport = {
      codeActionKind: {
        valueSet: [
          CodeActionKind.Empty,
          CodeActionKind.QuickFix,
          CodeActionKind.Refactor,
          CodeActionKind.RefactorExtract,
          CodeActionKind.RefactorInline,
          CodeActionKind.RefactorRewrite,
          CodeActionKind.Source,
          CodeActionKind.SourceOrganizeImports
        ]
      }
    }
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.codeActionProvider)
    if (!options) {
      return
    }

    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: CodeActionRegistrationOptions
  ): [Disposable, CodeActionProvider] {
    const provider: CodeActionProvider = {
      provideCodeActions: (document, range, context, token) => {
        const client = this._client
        const _provideCodeActions: ProvideCodeActionsSignature = (document, range, context, token) => {
          const params: CodeActionParams = {
            textDocument: {
              uri: document.uri
            },
            range,
            context,
          }
          return client.sendRequest(CodeActionRequest.type, params, token).then(
            (values) => {
              if (values === null) {
                return undefined
              }
              return values
            },
            (error) => {
              client.logFailedRequest(CodeActionRequest.type, error)
              return Promise.resolve([])
            }
          )
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideCodeActions
          ? middleware.provideCodeActions(document, range, context, token, _provideCodeActions)
          : _provideCodeActions(document, range, context, token)
      }
    }

    return [languages.registerCodeActionProvider(options.documentSelector, provider, this._client.id, options.codeActionKinds), provider]
  }
}

class CodeLensFeature extends TextDocumentFeature<CodeLensOptions, CodeLensRegistrationOptions, CodeLensProvider> {
  constructor(client: BaseLanguageClient) {
    super(client, CodeLensRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(
      ensure(capabilites, 'textDocument')!,
      'codeLens'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.codeLensProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: CodeLensRegistrationOptions
  ): [Disposable, CodeLensProvider] {
    const provider: CodeLensProvider = {
      provideCodeLenses: (document, token) => {
        const client = this._client
        const provideCodeLenses: ProvideCodeLensesSignature = (document, token) => {
          return client.sendRequest(
            CodeLensRequest.type,
            cv.asCodeLensParams(document),
            token
          ).then(res => res, error => {
            client.logFailedRequest(CodeLensRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideCodeLenses
          ? middleware.provideCodeLenses(document, token, provideCodeLenses)
          : provideCodeLenses(document, token)
      },
      resolveCodeLens: (options.resolveProvider)
        ? (codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens> => {
          const client = this._client
          const resolveCodeLens: ResolveCodeLensSignature = (codeLens, token) => {
            return client.sendRequest(
              CodeLensResolveRequest.type,
              codeLens,
              token
            ).then(res => res, error => {
              client.logFailedRequest(CodeLensResolveRequest.type, error)
              return codeLens
            })
          }
          const middleware = client.clientOptions.middleware!
          return middleware.resolveCodeLens
            ? middleware.resolveCodeLens(codeLens, token, resolveCodeLens)
            : resolveCodeLens(codeLens, token)
        }
        : undefined
    }

    return [languages.registerCodeLensProvider(options.documentSelector, provider), provider]
  }
}

class DocumentFormattingFeature extends TextDocumentFeature<
  boolean | DocumentFormattingOptions, DocumentHighlightRegistrationOptions, DocumentFormattingEditProvider
  > {

  constructor(client: BaseLanguageClient) {
    super(client, DocumentFormattingRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(
      ensure(capabilites, 'textDocument')!,
      'formatting'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentFormattingProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentFormattingEditProvider] {
    const provider: DocumentFormattingEditProvider = {
      provideDocumentFormattingEdits: (document, options, token) => {
        const client = this._client
        const provideDocumentFormattingEdits: ProvideDocumentFormattingEditsSignature = (document, options, token) => {
          const params: DocumentFormattingParams = {
            textDocument: { uri: document.uri },
            options
          }
          return client.sendRequest(DocumentFormattingRequest.type, params, token).then(res => res, (error) => {
            client.logFailedRequest(DocumentFormattingRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideDocumentFormattingEdits
          ? middleware.provideDocumentFormattingEdits(document, options, token, provideDocumentFormattingEdits)
          : provideDocumentFormattingEdits(document, options, token)
      }
    }

    return [
      languages.registerDocumentFormatProvider(options.documentSelector!, provider, this._client.clientOptions.formatterPriority),
      provider
    ]
  }
}

class DocumentRangeFormattingFeature extends TextDocumentFeature<
  boolean | DocumentRangeFormattingOptions, DocumentRangeFormattingRegistrationOptions, DocumentRangeFormattingEditProvider
  > {
  constructor(client: BaseLanguageClient) {
    super(client, DocumentRangeFormattingRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(
      ensure(capabilites, 'textDocument')!,
      'rangeFormatting'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentRangeFormattingProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentRangeFormattingEditProvider] {
    const provider: DocumentRangeFormattingEditProvider = {
      provideDocumentRangeFormattingEdits: (document, range, options, token) => {
        const client = this._client
        const provideDocumentRangeFormattingEdits: ProvideDocumentRangeFormattingEditsSignature = (document, range, options, token) => {
          const params: DocumentRangeFormattingParams = {
            textDocument: { uri: document.uri },
            range,
            options,
          }
          return client.sendRequest(DocumentRangeFormattingRequest.type, params, token).then(res => res, error => {
            client.logFailedRequest(DocumentRangeFormattingRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideDocumentRangeFormattingEdits
          ? middleware.provideDocumentRangeFormattingEdits(document, range, options, token, provideDocumentRangeFormattingEdits)
          : provideDocumentRangeFormattingEdits(document, range, options, token)
      }
    }

    return [languages.registerDocumentRangeFormatProvider(options.documentSelector, provider), provider]
  }
}

class DocumentOnTypeFormattingFeature extends TextDocumentFeature<
  DocumentOnTypeFormattingOptions, DocumentOnTypeFormattingRegistrationOptions, OnTypeFormattingEditProvider
  > {

  constructor(client: BaseLanguageClient) {
    super(client, DocumentOnTypeFormattingRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(ensure(capabilites, 'textDocument')!, 'onTypeFormatting')!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentOnTypeFormattingProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: DocumentOnTypeFormattingRegistrationOptions): [Disposable, OnTypeFormattingEditProvider] {
    const provider: OnTypeFormattingEditProvider = {
      provideOnTypeFormattingEdits: (document, position, ch, options, token) => {
        const client = this._client
        const provideOnTypeFormattingEdits: ProvideOnTypeFormattingEditsSignature = (document, position, ch, options, token) => {
          const params: DocumentOnTypeFormattingParams = {
            textDocument: cv.asVersionedTextDocumentIdentifier(document),
            position,
            ch,
            options
          }
          return client.sendRequest(DocumentOnTypeFormattingRequest.type, params, token).then(res => res, (error) => {
            client.logFailedRequest(DocumentOnTypeFormattingRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideOnTypeFormattingEdits
          ? middleware.provideOnTypeFormattingEdits(document, position, ch, options, token, provideOnTypeFormattingEdits)
          : provideOnTypeFormattingEdits(document, position, ch, options, token)
      }
    }

    const moreTriggerCharacter = options.moreTriggerCharacter || []
    const characters = [options.firstTriggerCharacter, ...moreTriggerCharacter]
    return [languages.registerOnTypeFormattingEditProvider(options.documentSelector!, provider, characters), provider]
  }
}

class RenameFeature extends TextDocumentFeature<boolean | RenameOptions, RenameRegistrationOptions, RenameProvider> {
  constructor(client: BaseLanguageClient) {
    super(client, RenameRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let rename = ensure(ensure(capabilites, 'textDocument')!, 'rename')!
    rename.dynamicRegistration = true
    rename.prepareSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.renameProvider)
    if (!options) {
      return
    }
    if (Is.boolean(capabilities.renameProvider)) {
      options.prepareProvider = false
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: RenameRegistrationOptions): [Disposable, RenameProvider] {
    const provider: RenameProvider = {
      provideRenameEdits: (document, position, newName, token) => {
        const client = this._client
        const provideRenameEdits: ProvideRenameEditsSignature = (document, position, newName, token) => {
          const params: RenameParams = {
            textDocument: { uri: document.uri },
            position,
            newName: newName
          }
          return client.sendRequest(RenameRequest.type, params, token).then(res => res, (error: ResponseError<void>) => {
            client.logFailedRequest(RenameRequest.type, error)
            return Promise.reject(new Error(error.message))
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideRenameEdits
          ? middleware.provideRenameEdits(document, position, newName, token, provideRenameEdits)
          : provideRenameEdits(document, position, newName, token)
      },
      prepareRename: options.prepareProvider
        ? (document, position, token) => {
          const client = this._client
          const prepareRename: PrepareRenameSignature = (document, position, token) => {
            const params: TextDocumentPositionParams = {
              textDocument: cv.asTextDocumentIdentifier(document),
              position
            }
            return client.sendRequest(PrepareRenameRequest.type, params, token).then(
              (result) => {
                if (Range.is(result)) {
                  return result
                } else if (result && Range.is(result.range)) {
                  return {
                    range: result.range,
                    placeholder: result.placeholder
                  }
                }
                // To cancel the rename vscode API expects a rejected promise.
                return Promise.reject(new Error(`The element can't be renamed.`))
              },
              (error: ResponseError<void>) => {
                client.logFailedRequest(PrepareRenameRequest.type, error)
                return Promise.reject(new Error(error.message))
              }
            )
          }
          const middleware = client.clientOptions.middleware!
          return middleware.prepareRename
            ? middleware.prepareRename(document, position, token, prepareRename)
            : prepareRename(document, position, token)
        }
        : undefined
    }

    return [languages.registerRenameProvider(options.documentSelector, provider), provider]
  }
}

class DocumentLinkFeature extends TextDocumentFeature<DocumentLinkOptions, DocumentLinkRegistrationOptions, DocumentLinkProvider> {
  constructor(client: BaseLanguageClient) {
    super(client, DocumentLinkRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    const documentLinkCapabilities = ensure(ensure(capabilites, 'textDocument')!, 'documentLink')!
    documentLinkCapabilities.dynamicRegistration = true
    // TODO support tooltip
    documentLinkCapabilities.tooltipSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentLinkProvider)
    if (!options) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: DocumentLinkRegistrationOptions
  ): [Disposable, DocumentLinkProvider] {
    const provider: DocumentLinkProvider = {
      provideDocumentLinks: (document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]> => {
        const client = this._client
        const provideDocumentLinks: ProvideDocumentLinksSignature = (document, token) => {
          return client.sendRequest(
            DocumentLinkRequest.type,
            {
              textDocument: { uri: document.uri }
            },
            token
          ).then(res => res, (error: ResponseError<void>) => {
            client.logFailedRequest(DocumentLinkRequest.type, error)
            return Promise.resolve([])
          })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideDocumentLinks
          ? middleware.provideDocumentLinks(document, token, provideDocumentLinks)
          : provideDocumentLinks(document, token)
      },
      resolveDocumentLink: options.resolveProvider
        ? (link, token) => {
          const client = this._client
          let resolveDocumentLink: ResolveDocumentLinkSignature = (link, token) => {
            return client.sendRequest(DocumentLinkResolveRequest.type, link, token).then(res => res, (error: ResponseError<void>) => {
              client.logFailedRequest(DocumentLinkResolveRequest.type, error)
              return Promise.resolve(link)
            })
          }
          const middleware = client.clientOptions.middleware!
          return middleware.resolveDocumentLink
            ? middleware.resolveDocumentLink(link, token, resolveDocumentLink)
            : resolveDocumentLink(link, token)
        }
        : undefined
    }

    return [languages.registerDocumentLinkProvider(options.documentSelector, provider), provider]
  }
}

class ConfigurationFeature implements DynamicFeature<DidChangeConfigurationRegistrationOptions> {
  private _listeners: Map<string, Disposable> = new Map<string, Disposable>()

  constructor(private _client: BaseLanguageClient) {}

  public get messages(): RPCMessageType {
    return DidChangeConfigurationNotification.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'workspace')!, 'didChangeConfiguration')!.dynamicRegistration = true
  }

  public initialize(): void {
    let section = this._client.clientOptions.synchronize?.configurationSection
    if (section !== void 0) {
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: {
          section: section
        }
      })
    }
  }

  public register(
    _message: RPCMessageType,
    data: RegistrationData<DidChangeConfigurationRegistrationOptions>
  ): void {
    let { section } = data.registerOptions
    let disposable = workspace.onDidChangeConfiguration((event) => {
      if (typeof section == 'string' && !event.affectsConfiguration(section)) {
        return
      }
      if (Array.isArray(section) && !section.some(v => event.affectsConfiguration(v))) {
        return
      }
      if (section != null) {
        this.onDidChangeConfiguration(data.registerOptions.section)
      }
    })
    this._listeners.set(data.id, disposable)
    if (Is.string(section) && section.endsWith('.settings')) {
      let settings = this.getConfiguredSettings(section as string)
      if (!settings || Is.emptyObject(settings)) return
    }
    if (section != null) {
      // Avoid server bug
      this.onDidChangeConfiguration(data.registerOptions.section)
    }
  }

  public unregister(id: string): void {
    let disposable = this._listeners.get(id)
    if (disposable) {
      this._listeners.delete(id)
      disposable.dispose()
    }
  }

  public dispose(): void {
    for (let disposable of this._listeners.values()) {
      disposable.dispose()
    }
    this._listeners.clear()
  }

  private onDidChangeConfiguration(configurationSection: string | string[]): void {
    let isConfigured = typeof configurationSection === 'string' && configurationSection.startsWith('languageserver.')
    let sections: string[] | undefined
    if (Is.string(configurationSection)) {
      sections = [configurationSection]
    } else {
      sections = configurationSection
    }
    let didChangeConfiguration = (sections: string[] | undefined): void => {
      if (sections === undefined) {
        this._client.sendNotification(DidChangeConfigurationNotification.type, { settings: null })
        return
      }
      this._client.sendNotification(DidChangeConfigurationNotification.type, {
        settings: isConfigured ? this.getConfiguredSettings(sections[0]) : this.extractSettingsInformation(sections)
      })
    }
    let middleware = this.getMiddleware()
    middleware
      ? middleware(sections, didChangeConfiguration)
      : didChangeConfiguration(sections)
  }

  // for configured languageserver
  private getConfiguredSettings(key: string): any {
    let len = '.settings'.length
    let config = workspace.getConfiguration(key.slice(0, - len))
    return config.get<any>('settings', {})
  }

  private extractSettingsInformation(keys: string[]): any {
    function ensurePath(config: any, path: string[]): any {
      let current = config
      for (let i = 0; i < path.length - 1; i++) {
        let obj = current[path[i]]
        if (!obj) {
          obj = Object.create(null)
          current[path[i]] = obj
        }
        current = obj
      }
      return current
    }
    let result = Object.create(null)
    for (let i = 0; i < keys.length; i++) {
      let key = keys[i]
      let index: number = key.indexOf('.')
      let config: any = null
      if (index >= 0) {
        config = workspace.getConfiguration(key.substr(0, index)).get(key.substr(index + 1))
      } else {
        config = workspace.getConfiguration(key)
      }
      if (config) {
        let path = keys[i].split('.')
        ensurePath(result, path)[path[path.length - 1]] = config
      }
    }
    return result
  }

  private getMiddleware() {
    let middleware = this._client.clientOptions.middleware!
    if (middleware.workspace && middleware.workspace.didChangeConfiguration) {
      return middleware.workspace.didChangeConfiguration
    } else {
      return undefined
    }
  }
}

class ExecuteCommandFeature
  implements DynamicFeature<ExecuteCommandRegistrationOptions> {
  private _commands: Map<string, Disposable[]> = new Map<string, Disposable[]>()
  constructor(private _client: BaseLanguageClient) {}

  public get messages(): RPCMessageType {
    return ExecuteCommandRequest.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'workspace')!,
      'executeCommand'
    )!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities): void {
    if (!capabilities.executeCommandProvider) {
      return
    }
    this.register(this.messages, {
      id: UUID.generateUuid(),
      registerOptions: Object.assign({}, capabilities.executeCommandProvider)
    })
  }

  public register(
    _message: RPCMessageType,
    data: RegistrationData<ExecuteCommandRegistrationOptions>
  ): void {
    const client = this._client
    const middleware = client.clientOptions.middleware!
    const executeCommand: ExecuteCommandSignature = (command: string, args: any[]): any => {
      const params: ExecuteCommandParams = {
        command,
        arguments: args
      }
      return client.sendRequest(ExecuteCommandRequest.type, params).then(undefined, (error) => {
        client.logFailedRequest(ExecuteCommandRequest.type, error)
        throw error
      })
    }
    if (data.registerOptions.commands) {
      let disposables: Disposable[] = []
      for (const command of data.registerOptions.commands) {
        disposables.push(commands.registerCommand(command, (...args: any[]) => {
          return middleware.executeCommand
            ? middleware.executeCommand(command, args, executeCommand)
            : executeCommand(command, args)
        }, null, true))
      }
      this._commands.set(data.id, disposables)
    }
  }

  public unregister(id: string): void {
    let disposables = this._commands.get(id)
    if (disposables) {
      disposables.forEach(disposable => disposable.dispose())
    }
  }

  public dispose(): void {
    this._commands.forEach(value => {
      value.forEach(disposable => disposable.dispose())
    })
    this._commands.clear()
  }
}

export interface MessageTransports {
  reader: MessageReader
  writer: MessageWriter
  detached?: boolean
}

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

class OnReady {
  private _used: boolean
  constructor(private _resolve: () => void, private _reject: (error: any) => void) {
    this._used = false
  }

  public get isUsed(): boolean {
    return this._used
  }

  public resolve(): void {
    this._used = true
    this._resolve()
  }

  public reject(error: any): void {
    this._used = true
    this._reject(error)
  }
}

export abstract class BaseLanguageClient {
  private _id: string
  private _name: string
  private _markdownSupport: boolean
  private _clientOptions: ResolvedClientOptions

  protected _state: ClientState
  private _onReady: Promise<void>
  private _onReadyCallbacks: OnReady
  private _onStop: Promise<void> | undefined
  private _connectionPromise: Promise<IConnection> | undefined
  private _resolvedConnection: IConnection | undefined
  private _initializeResult: InitializeResult | undefined
  private _outputChannel: OutputChannel | undefined
  private _capabilities: ServerCapabilities & ResolvedTextDocumentSyncCapabilities

  private _listeners: Disposable[] | undefined
  private _providers: Disposable[] | undefined
  private _diagnostics: DiagnosticCollection | undefined
  private _syncedDocuments: Map<string, TextDocument>

  private _fileEvents: FileEvent[]
  private _fileEventDelayer: Delayer<void>
  private _stateChangeEmitter: Emitter<StateChangeEvent>

  private _traceFormat: TraceFormat
  private _trace: Trace
  private _tracer: Tracer

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
    this._clientOptions = {
      disableWorkspaceFolders: clientOptions.disableWorkspaceFolders,
      disableSnippetCompletion: clientOptions.disableSnippetCompletion,
      disableDynamicRegister: clientOptions.disableDynamicRegister,
      disableDiagnostics: clientOptions.disableDiagnostics,
      disableCompletion: clientOptions.disableCompletion,
      formatterPriority: clientOptions.formatterPriority,
      ignoredRootPaths: clientOptions.ignoredRootPaths,
      documentSelector: clientOptions.documentSelector || [],
      synchronize: clientOptions.synchronize || {},
      diagnosticCollectionName: clientOptions.diagnosticCollectionName,
      outputChannelName: clientOptions.outputChannelName || this._id,
      revealOutputChannelOn:
        clientOptions.revealOutputChannelOn || RevealOutputChannelOn.Never,
      stdioEncoding: clientOptions.stdioEncoding || 'utf8',
      initializationOptions: clientOptions.initializationOptions,
      initializationFailedHandler: clientOptions.initializationFailedHandler,
      progressOnInitialization: !!clientOptions.progressOnInitialization,
      errorHandler: clientOptions.errorHandler || new DefaultErrorHandler(this._id),
      middleware: clientOptions.middleware || {},
      workspaceFolder: clientOptions.workspaceFolder
    }
    this.state = ClientState.Initial
    this._connectionPromise = undefined
    this._resolvedConnection = undefined
    this._initializeResult = undefined
    this._listeners = undefined
    this._providers = undefined
    this._diagnostics = undefined

    this._fileEvents = []
    this._fileEventDelayer = new Delayer<void>(250)
    this._onReady = new Promise<void>((resolve, reject) => {
      this._onReadyCallbacks = new OnReady(resolve, reject)
    })
    this._onStop = undefined
    this._stateChangeEmitter = new Emitter<StateChangeEvent>()
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
    let preferences = workspace.getConfiguration('coc.preferences')
    this._markdownSupport = preferences.get('enableMarkdown', true)
    this.registerBuiltinFeatures()
  }

  public get supporedMarkupKind(): MarkupKind[] {
    if (this._markdownSupport) return [MarkupKind.Markdown, MarkupKind.PlainText]
    return [MarkupKind.PlainText]
  }

  private get state(): ClientState {
    return this._state
  }

  public get id(): string {
    return this._id
  }

  public get name(): string {
    return this._name
  }

  private set state(value: ClientState) {
    let oldState = this.getPublicState()
    this._state = value
    let newState = this.getPublicState()
    if (newState !== oldState) {
      this._stateChangeEmitter.fire({ oldState, newState })
    }
  }

  public getPublicState(): State {
    if (this.state === ClientState.Running) {
      return State.Running
    } else if (this.state === ClientState.Starting) {
      return State.Starting
    } else {
      return State.Stopped
    }
  }

  public get initializeResult(): InitializeResult | undefined {
    return this._initializeResult
  }

  public sendRequest<R, E, RO>(
    type: RequestType0<R, E, RO>,
    token?: CancellationToken
  ): Promise<R>
  public sendRequest<P, R, E, RO>(
    type: RequestType<P, R, E, RO>,
    params: P,
    token?: CancellationToken
  ): Promise<R>
  public sendRequest<R>(method: string, token?: CancellationToken): Promise<R>
  public sendRequest<R>(
    method: string,
    param: any,
    token?: CancellationToken
  ): Promise<R>
  public async sendRequest<R>(
    type: string | RPCMessageType,
    ...params: any[]
  ): Promise<R> {
    if (!this.isConnectionActive()) {
      throw new Error('Language client is not ready yet')
    }
    try {
      return this._resolvedConnection!.sendRequest<R>(type, ...params)
    } catch (error) {
      this.error(
        `Sending request ${Is.string(type) ? type : type.method} failed.`,
        error
      )
      throw error
    }
  }

  public onRequest<R, E, RO>(
    type: RequestType0<R, E, RO>,
    handler: RequestHandler0<R, E>
  ): void
  public onRequest<P, R, E, RO>(
    type: RequestType<P, R, E, RO>,
    handler: RequestHandler<P, R, E>
  ): void
  public onRequest<R, E>(
    method: string,
    handler: GenericRequestHandler<R, E>
  ): void
  public onRequest<R, E>(
    type: string | RPCMessageType,
    handler: GenericRequestHandler<R, E>
  ): void {
    if (!this.isConnectionActive()) {
      throw new Error('Language client is not ready yet')
    }
    try {
      this._resolvedConnection!.onRequest(type, handler)
    } catch (error) {
      this.error(
        `Registering request handler ${Is.string(type) ? type : type.method
        } failed.`,
        error
      )
      throw error
    }
  }

  public sendNotification<RO>(type: NotificationType0<RO>): void
  public sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void
  public sendNotification(method: string): void
  public sendNotification(method: string, params: any): void
  public sendNotification<P>(type: string | RPCMessageType, params?: P): void {
    if (!this.isConnectionActive()) {
      throw new Error('Language client is not ready yet')
    }
    try {
      this._resolvedConnection!.sendNotification(type, params)
    } catch (error) {
      this.error(
        `Sending notification ${Is.string(type) ? type : type.method} failed.`,
        error
      )
      throw error
    }
  }

  public onNotification<RO>(type: NotificationType0<RO>, handler: NotificationHandler0): void
  public onNotification<P, RO>(type: NotificationType<P, RO>, handler: NotificationHandler<P>): void
  public onNotification(method: string, handler: GenericNotificationHandler): void
  public onNotification(type: string | RPCMessageType, handler: GenericNotificationHandler): void {
    if (!this.isConnectionActive()) {
      throw new Error('Language client is not ready yet')
    }
    try {
      this._resolvedConnection!.onNotification(type, handler)
    } catch (error) {
      this.error(
        `Registering notification handler ${Is.string(type) ? type : type.method
        } failed.`,
        error
      )
      throw error
    }
  }

  public onProgress<P>(type: ProgressType<any>, token: string | number, handler: NotificationHandler<P>): Disposable {
    if (!this.isConnectionActive()) {
      throw new Error('Language client is not ready yet')
    }
    try {
      if (type == WorkDoneProgress.type) {
        const handleWorkDoneProgress = this._clientOptions.middleware!.handleWorkDoneProgress
        if (handleWorkDoneProgress !== undefined) {
          return this._resolvedConnection!.onProgress(type, token, (params) => {
            handleWorkDoneProgress(token, params as any, () => handler(params as unknown as P))
          })
        }
      }
      return this._resolvedConnection!.onProgress(type, token, handler)
    } catch (error) {
      this.error(`Registering progress handler for token ${token} failed.`, error)
      throw error
    }
  }

  public sendProgress<P>(type: ProgressType<P>, token: string | number, value: P): void {
    if (!this.isConnectionActive()) {
      throw new Error('Language client is not ready yet')
    }
    try {
      this._resolvedConnection!.sendProgress(type, token, value)
    } catch (error) {
      this.error(`Sending progress for token ${token} failed.`, error)
      throw error
    }
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
      this._outputChannel = window.createOutputChannel(outputChannelName ? outputChannelName : this._name)
    }
    return this._outputChannel
  }

  public get diagnostics(): DiagnosticCollection | undefined {
    return this._diagnostics
  }

  public createDefaultErrorHandler(): ErrorHandler {
    return new DefaultErrorHandler(this._id)
  }

  public set trace(value: Trace) {
    this._trace = value
    this.onReady().then(
      () => {
        this.resolveConnection().then(connection => {
          connection.trace(this._trace, this._tracer, {
            sendNotification: false,
            traceFormat: this._traceFormat
          })
        })
      },
      () => {}
    )
  }

  private logObjectTrace(data: any): void {
    if (data.isLSPMessage && data.type) {
      this.outputChannel.append(`[LSP   - ${(new Date().toLocaleTimeString())}] `)
    } else {
      this.outputChannel.append(`[Trace - ${(new Date().toLocaleTimeString())}] `)
    }
    if (data) {
      this.outputChannel.appendLine(`${JSON.stringify(data)}`)
    }
  }

  private data2String(data: any): string {
    if (data instanceof ResponseError) {
      const responseError = data as ResponseError<any>
      return `  Message: ${responseError.message}\n  Code: ${responseError.code
        } ${responseError.data ? '\n' + responseError.data.toString() : ''}`
    }
    if (data instanceof Error) {
      if (Is.string(data.stack)) {
        return data.stack
      }
      return (data as Error).message
    }
    if (Is.string(data)) {
      return data
    }
    return data.toString()
  }

  private _appendOutput(type: string, message: string, data?: any): void {
    let level = RevealOutputChannelOn.Error
    switch (type) {
      case 'Info':
        level = RevealOutputChannelOn.Info
        break
      case 'Warn':
        level = RevealOutputChannelOn.Warn
        break
    }
    this.outputChannel.appendLine(`[${type}  - ${(new Date().toLocaleTimeString())}] ${message}`)
    let dataString: string
    if (data) {
      dataString = this.data2String(data)
      this.outputChannel.appendLine(dataString)
    }
    if (this._clientOptions.revealOutputChannelOn <= level) {
      this.outputChannel.show(true)
    }
  }

  public info(message: string, data?: any): void {
    this._appendOutput('Info', message, data)
  }

  public warn(message: string, data?: any): void {
    this._appendOutput('Warn', message, data)
  }

  public error(message: string, data?: any): void {
    this._appendOutput('Error', message, data)
  }

  private logTrace(message: string, data?: any): void {
    this.outputChannel.appendLine(`[Trace - ${(new Date().toLocaleTimeString())}] ${message}`)
    if (data) {
      this.outputChannel.appendLine(this.data2String(data))
    }
  }

  public needsStart(): boolean {
    return (
      this.state === ClientState.Initial ||
      this.state === ClientState.Stopping ||
      this.state === ClientState.Stopped
    )
  }

  public needsStop(): boolean {
    return (
      this.state === ClientState.Starting || this.state === ClientState.Running
    )
  }

  public onReady(): Promise<void> {
    return this._onReady
  }

  public get started(): boolean {
    return this.state != ClientState.Initial
  }

  private isConnectionActive(): boolean {
    return this.state === ClientState.Running && !!this._resolvedConnection
  }

  public start(): Disposable {
    if (this._onReadyCallbacks.isUsed) {
      this._onReady = new Promise((resolve, reject) => {
        this._onReadyCallbacks = new OnReady(resolve, reject)
      })
    }
    this._listeners = []
    this._providers = []
    // If we restart then the diagnostics collection is reused.
    if (!this._diagnostics) {
      let opts = this._clientOptions
      let name = opts.diagnosticCollectionName ? opts.diagnosticCollectionName : this._id
      this._diagnostics = languages.createDiagnosticCollection(name)
    }

    this.state = ClientState.Starting
    this.resolveConnection()
      .then(connection => {
        connection.onLogMessage(message => {
          let kind: string
          switch (message.type) {
            case MessageType.Error:
              kind = 'error'
              this.error(message.message)
              break
            case MessageType.Warning:
              kind = 'warning'
              this.warn(message.message)
              break
            case MessageType.Info:
              kind = 'info'
              this.info(message.message)
              break
            default:
              kind = 'log'
              this.outputChannel.appendLine(message.message)
          }
          if (global.hasOwnProperty('__TEST__')) {
            console.log(`[${kind}] ${message.message}`)
            return
          }
        })
        connection.onShowMessage(message => {
          switch (message.type) {
            case MessageType.Error:
              window.showErrorMessage(message.message)
              break
            case MessageType.Warning:
              window.showWarningMessage(message.message)
              break
            case MessageType.Info:
              window.showInformationMessage(message.message)
              break
            default:
              window.showInformationMessage(message.message)
          }
        })
        connection.onRequest(ShowMessageRequest.type, params => {
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
          let actions = params.actions || []
          return messageFunc(params.message, ...actions)
        })
        connection.onTelemetry(_data => {
          // ignored
        })
        connection.listen()
        // Error is handled in the intialize call.
        return this.initialize(connection)
      }).then(undefined, error => {
        this.state = ClientState.StartFailed
        this._onReadyCallbacks.reject(error)
        this.error('Starting client failed ', error)
      })
    return Disposable.create(() => {
      if (this.needsStop()) {
        this.stop()
      }
    })
  }

  private resolveConnection(): Promise<IConnection> {
    if (!this._connectionPromise) {
      this._connectionPromise = this.createConnection()
    }
    return this._connectionPromise
  }

  private resolveRootPath(): string | null {
    if (this._clientOptions.workspaceFolder) {
      return URI.parse(this._clientOptions.workspaceFolder.uri).fsPath
    }
    let { ignoredRootPaths } = this._clientOptions
    let config = workspace.getConfiguration(this.id)
    let rootPatterns = config.get<string[]>('rootPatterns', [])
    let required = config.get<boolean>('requireRootPattern', false)
    let resolved: string
    if (rootPatterns && rootPatterns.length) {
      let doc = workspace.getDocument(workspace.bufnr)
      if (doc && doc.schema == 'file') {
        let dir = path.dirname(URI.parse(doc.uri).fsPath)
        resolved = resolveRoot(dir, rootPatterns, workspace.cwd)
      }
    }
    if (required && !resolved) return null
    let rootPath = resolved || workspace.rootPath || workspace.cwd
    if (ignoredRootPaths && ignoredRootPaths.indexOf(rootPath) !== -1) {
      window.showMessage(`Ignored rootPath ${rootPath} of client "${this._id}"`, 'warning')
      return null
    }
    return rootPath
  }

  private initialize(connection: IConnection): Promise<InitializeResult> {
    this.refreshTrace(connection, false)
    let { initializationOptions, progressOnInitialization } = this._clientOptions
    let rootPath = this.resolveRootPath()
    if (!rootPath) return
    let initParams: any = {
      processId: process.pid,
      rootPath: rootPath ? rootPath : null,
      rootUri: rootPath ? cv.asUri(URI.file(rootPath)) : null,
      capabilities: this.computeClientCapabilities(),
      initializationOptions: Is.func(initializationOptions) ? initializationOptions() : initializationOptions,
      trace: Trace.toString(this._trace),
      workspaceFolders: null,
      clientInfo: {
        name: 'coc.nvim',
        version: workspace.version
      }
    }
    this.fillInitializeParams(initParams)
    if (progressOnInitialization) {
      const token: ProgressToken = UUID.generateUuid()
      initParams.workDoneToken = token
      const part = new ProgressPart(connection, token)
      part.begin({ title: `initializing ${this.id}`, kind: 'begin' })
      return this.doInitialize(connection, initParams).then((result) => {
        part.done()
        return result
      }, (error) => {
        part.cancel()
        throw error
      })
    } else {
      return this.doInitialize(connection, initParams)
    }
  }

  private doInitialize(connection: IConnection, initParams: InitializeParams): Promise<InitializeResult> {
    return connection.initialize(initParams).then(result => {
      this._resolvedConnection = connection
      this._initializeResult = result
      this.state = ClientState.Running

      let textDocumentSyncOptions: TextDocumentSyncOptions | undefined = undefined
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
      } else if (result.capabilities.textDocumentSync != null) {
        textDocumentSyncOptions = result.capabilities.textDocumentSync as TextDocumentSyncOptions
      }
      this._capabilities = Object.assign({}, result.capabilities, {
        resolvedTextDocumentSync: textDocumentSyncOptions
      })
      if (!this._clientOptions.disableDiagnostics) {
        connection.onDiagnostics(params => this.handleDiagnostics(params))
      }
      connection.onRequest(RegistrationRequest.type, params =>
        this.handleRegistrationRequest(params)
      )
      // See https://github.com/Microsoft/vscode-languageserver-node/issues/199
      connection.onRequest('client/registerFeature', params =>
        this.handleRegistrationRequest(params)
      )
      connection.onRequest(UnregistrationRequest.type, params =>
        this.handleUnregistrationRequest(params)
      )
      // See https://github.com/Microsoft/vscode-languageserver-node/issues/199
      connection.onRequest('client/unregisterFeature', params =>
        this.handleUnregistrationRequest(params)
      )
      connection.onRequest(ApplyWorkspaceEditRequest.type, params =>
        this.handleApplyWorkspaceEdit(params)
      )

      connection.sendNotification(InitializedNotification.type, {})

      this.hookFileEvents(connection)
      this.hookConfigurationChanged(connection)
      this.initializeFeatures(connection)
      this._onReadyCallbacks.resolve()
      return result
    }).then<InitializeResult>(undefined, error => {
      if (this._clientOptions.initializationFailedHandler) {
        if (this._clientOptions.initializationFailedHandler(error)) {
          this.initialize(connection)
        } else {
          this.stop()
          this._onReadyCallbacks.reject(error)
        }
      } else if (
        error instanceof ResponseError &&
        error.data &&
        error.data.retry
      ) {
        window.showPrompt(error.message + ' Retry?').then(confirmed => {
          if (confirmed) {
            this.initialize(connection)
          } else {
            this.stop()
            this._onReadyCallbacks.reject(error)
          }
        })
      } else {
        if (error && error.message) {
          window.showMessage(error.message, 'error')
        }
        this.error('Server initialization failed.', error)
        this.stop()
        this._onReadyCallbacks.reject(error)
      }
      throw error
    })
  }

  public stop(): Promise<void> {
    this._initializeResult = undefined
    if (!this._connectionPromise) {
      this.state = ClientState.Stopped
      return Promise.resolve()
    }
    if (this.state === ClientState.Stopping && this._onStop) {
      return this._onStop
    }
    this.state = ClientState.Stopping
    this.cleanUp()
    // unkook listeners
    return (this._onStop = this.resolveConnection().then(connection => {
      return connection.shutdown().then(() => {
        connection.exit()
        connection.dispose()
        this.state = ClientState.Stopped
        this.cleanUpChannel()
        this._onStop = undefined
        this._connectionPromise = undefined
        this._resolvedConnection = undefined
      })
    }).catch(e => {
      logger.error('Error on stop languageserver:', e)
      this.state = ClientState.Stopped
      this.cleanUpChannel()
      this._onStop = undefined
      this._connectionPromise = undefined
      this._resolvedConnection = undefined
    }))
  }

  private cleanUp(channel: boolean = true, diagnostics: boolean = true): void {
    if (this._listeners) {
      this._listeners.forEach(listener => listener.dispose())
      this._listeners = undefined
    }
    if (this._providers) {
      this._providers.forEach(provider => provider.dispose())
      this._providers = undefined
    }
    for (let feature of this._features.values()) {
      if (typeof feature.dispose === 'function') {
        feature.dispose()
      } else {
        logger.error(`Feature can't be disposed`, feature)
      }
    }
    if (this._syncedDocuments) {
      this._syncedDocuments.clear()
    }
    if (channel) {
      this.cleanUpChannel()
    }
    if (this._diagnostics) {
      if (diagnostics) {
        this._diagnostics.dispose()
        this._diagnostics = undefined
      } else {
        this._diagnostics.clear()
      }
    }
  }

  private cleanUpChannel(): void {
    if (this._outputChannel) {
      this._outputChannel.dispose()
      this._outputChannel = undefined
    }
  }

  private notifyFileEvent(event: FileEvent): void {
    const client = this
    function didChangeWatchedFile(this: void, event: FileEvent) {
      client._fileEvents.push(event)
      client._fileEventDelayer.trigger(() => {
        client.onReady().then(() => {
          client.resolveConnection().then(connection => {
            if (client.isConnectionActive()) {
              connection.didChangeWatchedFiles({ changes: client._fileEvents })
            }
            client._fileEvents = []
          })
        }, (error) => {
          client.error(`Notify file events failed.`, error)
        })
      })
    }
    const workSpaceMiddleware = this.clientOptions.middleware?.workspace
    workSpaceMiddleware?.didChangeWatchedFile ? workSpaceMiddleware.didChangeWatchedFile(event, didChangeWatchedFile) : didChangeWatchedFile(event)
  }

  private handleDiagnostics(params: PublishDiagnosticsParams) {
    if (!this._diagnostics) {
      return
    }
    let { uri, diagnostics } = params
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
    if (!this._diagnostics) {
      return
    }

    const separate = workspace.getConfiguration('diagnostic').get('separateRelatedInformationAsDiagnostics') as boolean
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

  protected abstract createMessageTransports(
    encoding: string
  ): Promise<MessageTransports | null>

  private createConnection(): Promise<IConnection> {
    let errorHandler = (error: Error, message: Message, count: number) => {
      logger.error('connection error:', error, message)
      this.handleConnectionError(error, message, count)
    }

    let closeHandler = () => {
      this.handleConnectionClosed()
    }

    return this.createMessageTransports(
      this._clientOptions.stdioEncoding || 'utf8'
    ).then(transports => {
      return createConnection(
        transports.reader,
        transports.writer,
        errorHandler,
        closeHandler
      )
    })
  }

  protected handleConnectionClosed() {
    // Check whether this is a normal shutdown in progress or the client stopped normally.
    if (
      this.state === ClientState.Stopping ||
      this.state === ClientState.Stopped
    ) {
      return
    }
    try {
      if (this._resolvedConnection) {
        this._resolvedConnection.dispose()
      }
    } catch (error) {
      // Disposing a connection could fail if error cases.
    }
    let action = CloseAction.DoNotRestart
    try {
      action = this._clientOptions.errorHandler!.closed()
    } catch (error) {
      // Ignore errors coming from the error handler.
    }
    this._connectionPromise = undefined
    this._resolvedConnection = undefined
    if (action === CloseAction.DoNotRestart) {
      this.error(
        'Connection to server got closed. Server will not be restarted.'
      )
      this.state = ClientState.Stopped
      this.cleanUp(false, true)
    } else if (action === CloseAction.Restart) {
      this.info('Connection to server got closed. Server will restart.')
      this.cleanUp(false, true)
      this.state = ClientState.Initial
      this.start()
    }
  }

  public restart(): void {
    this.cleanUp(true, false)
    this.start()
  }

  private handleConnectionError(error: Error, message: Message, count: number) {
    let action = this._clientOptions.errorHandler!.error(error, message, count)
    if (action === ErrorAction.Shutdown) {
      this.error('Connection to server is erroring. Shutting down server.')
      this.stop()
    }
  }

  private hookConfigurationChanged(connection: IConnection): void {
    workspace.onDidChangeConfiguration(() => {
      this.refreshTrace(connection, true)
    })
  }

  private refreshTrace(
    connection: IConnection,
    sendNotification: boolean = false
  ): void {
    let config = workspace.getConfiguration(this._id)
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
    this._trace = trace
    this._traceFormat = traceFormat
    connection.trace(this._trace, this._tracer, {
      sendNotification,
      traceFormat: this._traceFormat
    })
  }

  private hookFileEvents(_connection: IConnection): void {
    let fileEvents = this._clientOptions.synchronize.fileEvents
    if (!fileEvents) return
    let watchers: FileWatcher[]
    if (Array.isArray(fileEvents)) {
      watchers = <FileWatcher[]>fileEvents
    } else {
      watchers = [<FileWatcher>fileEvents]
    }
    if (!watchers) {
      return
    }
    (this._dynamicFeatures.get(
      DidChangeWatchedFilesNotification.type.method
    )! as FileSystemWatcherFeature).registerRaw(UUID.generateUuid(), watchers)
  }

  private readonly _features: (StaticFeature | DynamicFeature<any>)[] = []
  private readonly _method2Message: Map<string, RPCMessageType> = new Map<
    string,
    RPCMessageType
  >()
  private readonly _dynamicFeatures: Map<string, DynamicFeature<any>> = new Map<
    string,
    DynamicFeature<any>
  >()

  public registerFeatures(
    features: (StaticFeature | DynamicFeature<any>)[]
  ): void {
    for (let feature of features) {
      this.registerFeature(feature)
    }
  }

  public registerFeature(feature: StaticFeature | DynamicFeature<any>): void {
    this._features.push(feature)
    if (DynamicFeature.is(feature)) {
      let messages = feature.messages
      if (Array.isArray(messages)) {
        for (let message of messages) {
          this._method2Message.set(message.method, message)
          this._dynamicFeatures.set(message.method, feature)
        }
      } else {
        this._method2Message.set(messages.method, messages)
        this._dynamicFeatures.set(messages.method, feature)
      }
    }
  }

  public getFeature(request: typeof DidOpenTextDocumentNotification.method): DynamicFeature<TextDocumentRegistrationOptions> & NotificationFeature<(textDocument: TextDocument) => void>
  public getFeature(request: typeof DidChangeTextDocumentNotification.method): DynamicFeature<TextDocumentRegistrationOptions> & NotificationFeature<(textDocument: TextDocument) => void>
  public getFeature(request: typeof WillSaveTextDocumentNotification.method): DynamicFeature<TextDocumentRegistrationOptions> & NotificationFeature<(textDocument: TextDocument) => void>
  public getFeature(request: typeof WillSaveTextDocumentWaitUntilRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & NotificationFeature<(textDocument: TextDocument) => ProviderResult<TextEdit[]>>
  public getFeature(request: typeof DidSaveTextDocumentNotification.method): DynamicFeature<TextDocumentRegistrationOptions> & NotificationFeature<(textDocument: TextDocument) => void>
  public getFeature(request: typeof DidCloseTextDocumentNotification.method): DynamicFeature<TextDocumentRegistrationOptions> & NotificationFeature<(textDocument: TextDocument) => void>
  public getFeature(request: typeof CompletionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CompletionItemProvider>
  public getFeature(request: typeof HoverRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<HoverProvider>
  public getFeature(request: typeof SignatureHelpRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SignatureHelpProvider>
  public getFeature(request: typeof DefinitionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DefinitionProvider>
  public getFeature(request: typeof ReferencesRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<ReferenceProvider>
  public getFeature(request: typeof DocumentHighlightRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentHighlightProvider>
  public getFeature(request: typeof CodeActionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<CodeActionProvider>
  public getFeature(request: typeof DocumentFormattingRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentFormattingEditProvider>
  public getFeature(request: typeof DocumentRangeFormattingRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentRangeFormattingEditProvider>
  public getFeature(request: typeof DocumentOnTypeFormattingRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<OnTypeFormattingEditProvider>
  public getFeature(request: typeof RenameRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<RenameProvider>
  public getFeature(request: typeof DocumentLinkRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentLinkProvider>
  public getFeature(request: typeof DocumentColorRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DocumentColorProvider>
  public getFeature(request: typeof DeclarationRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<DeclarationProvider>
  public getFeature(request: typeof FoldingRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<FoldingRangeProvider>
  public getFeature(request: typeof ImplementationRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<ImplementationProvider>
  public getFeature(request: typeof SelectionRangeRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<SelectionRangeProvider>
  public getFeature(request: typeof TypeDefinitionRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<TypeDefinitionProvider>
  public getFeature(request: typeof Proposed.CallHierarchyPrepareRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & TextDocumentProviderFeature<TypeDefinitionProvider>
  public getFeature(request: typeof WorkspaceSymbolRequest.method): DynamicFeature<TextDocumentRegistrationOptions> & WorkspaceProviderFeature<WorkspaceSymbolProvider>
  public getFeature(request: string): DynamicFeature<any> | undefined {
    return this._dynamicFeatures.get(request)
  }

  protected registerBuiltinFeatures() {
    this.registerFeature(new ConfigurationFeature(this))
    this.registerFeature(new DidOpenTextDocumentFeature(this, this._syncedDocuments))
    this.registerFeature(new DidChangeTextDocumentFeature(this))
    this.registerFeature(new WillSaveFeature(this))
    this.registerFeature(new WillSaveWaitUntilFeature(this))
    this.registerFeature(new DidSaveTextDocumentFeature(this))
    this.registerFeature(new DidCloseTextDocumentFeature(this, this._syncedDocuments))
    this.registerFeature(new FileSystemWatcherFeature(this, event => this.notifyFileEvent(event)))
    if (!this._clientOptions.disableCompletion) {
      this.registerFeature(new CompletionItemFeature(this))
    }
    this.registerFeature(new HoverFeature(this))
    this.registerFeature(new SignatureHelpFeature(this))
    this.registerFeature(new DefinitionFeature(this))
    this.registerFeature(new ReferencesFeature(this))
    this.registerFeature(new DocumentHighlightFeature(this))
    this.registerFeature(new DocumentSymbolFeature(this))
    this.registerFeature(new WorkspaceSymbolFeature(this))
    this.registerFeature(new CodeActionFeature(this))
    this.registerFeature(new CodeLensFeature(this))
    this.registerFeature(new DocumentFormattingFeature(this))
    this.registerFeature(new DocumentRangeFormattingFeature(this))
    this.registerFeature(new DocumentOnTypeFormattingFeature(this))
    this.registerFeature(new RenameFeature(this))
    this.registerFeature(new DocumentLinkFeature(this))
    this.registerFeature(new ExecuteCommandFeature(this))
  }

  private fillInitializeParams(params: InitializeParams): void {
    for (let feature of this._features) {
      if (Is.func(feature.fillInitializeParams)) {
        feature.fillInitializeParams(params)
      }
    }
  }

  private computeClientCapabilities(): ClientCapabilities {
    let result: ClientCapabilities = {}
    ensure(result, 'workspace')!.applyEdit = true
    let workspaceEdit = ensure(ensure(result, 'workspace')!, 'workspaceEdit')
    workspaceEdit.documentChanges = true
    workspaceEdit.resourceOperations = [ResourceOperationKind.Create, ResourceOperationKind.Rename, ResourceOperationKind.Delete]
    workspaceEdit.failureHandling = FailureHandlingKind.TextOnlyTransactional
    const diagnostics = ensure(ensure(result, 'textDocument')!, 'publishDiagnostics')!
    diagnostics.relatedInformation = true
    diagnostics.versionSupport = false
    diagnostics.tagSupport = { valueSet: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated] }
    for (let feature of this._features) {
      feature.fillClientCapabilities(result)
    }
    return result
  }

  private initializeFeatures(_connection: IConnection): void {
    let documentSelector = this._clientOptions.documentSelector
    for (let feature of this._features) {
      feature.initialize(this._capabilities, documentSelector)
    }
  }

  private handleRegistrationRequest(
    params: RegistrationParams
  ): Promise<void> {
    if (this.clientOptions.disableDynamicRegister) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      for (let registration of params.registrations) {
        const feature = this._dynamicFeatures.get(registration.method)
        if (!feature) {
          reject(
            new Error(
              `No feature implementation for ${registration.method} found. Registration failed.`
            )
          )
          return
        }
        const options = registration.registerOptions || {}
        options.documentSelector = options.documentSelector || this._clientOptions.documentSelector
        const data: RegistrationData<any> = {
          id: registration.id,
          registerOptions: options
        }
        feature.register(this._method2Message.get(registration.method)!, data)
      }
      resolve()
    })
  }

  private handleUnregistrationRequest(
    params: UnregistrationParams
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      for (let unregistration of params.unregisterations) {
        const feature = this._dynamicFeatures.get(unregistration.method)
        if (!feature) {
          reject(
            new Error(
              `No feature implementation for ${unregistration.method} found. Unregistration failed.`
            )
          )
          return
        }
        feature.unregister(unregistration.id)
      }
      resolve()
    })
  }

  private handleApplyWorkspaceEdit(
    params: ApplyWorkspaceEditParams
  ): Promise<ApplyWorkspaceEditResponse> {
    // This is some sort of workaround since the version check should be done by VS Code in the Workspace.applyEdit.
    // However doing it here adds some safety since the server can lag more behind then an extension.
    let workspaceEdit: WorkspaceEdit = params.edit
    let openTextDocuments: Map<string, TextDocument> = new Map<string, TextDocument>()
    workspace.textDocuments.forEach((document) => openTextDocuments.set(document.uri.toString(), document))
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

  public logFailedRequest(type: RPCMessageType, error: any): void {
    // If we get a request cancel don't log anything.
    if (
      error instanceof ResponseError &&
      error.code === ErrorCodes.RequestCancelled
    ) {
      return
    }
    this.error(`Request ${type.method} failed.`, error)
  }
}
