import { CancellationToken, ClientCapabilities, CodeAction, CodeActionContext, CodeLens, Command, CompletionContext, CompletionItem, CompletionList, Definition, Diagnostic, DidChangeTextDocumentParams, Disposable, DocumentHighlight, DocumentLink, DocumentSelector, DocumentSymbol, Event, FormattingOptions, GenericNotificationHandler, GenericRequestHandler, Hover, InitializeError, InitializeParams, InitializeResult, Location, Message, MessageReader, MessageWriter, NotificationHandler, NotificationHandler0, NotificationType, NotificationType0, Position, Range, RequestHandler, RequestHandler0, RequestType, RequestType0, ResponseError, RPCMessageType, ServerCapabilities, SignatureHelp, SymbolInformation, TextDocument, TextDocumentRegistrationOptions, TextEdit, Trace, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageserver-protocol';
import FileWatcher from '../model/fileSystemWatcher';
import { ProviderResult } from '../provider';
import { DiagnosticCollection, OutputChannel, TextDocumentWillSaveEvent, Thenable } from '../types';
import { ColorProviderMiddleware } from './colorProvider';
import { ConfigurationWorkspaceMiddleware } from './configuration';
import { FoldingRangeProviderMiddleware } from './foldingRange';
import { ImplementationMiddleware } from './implementation';
import { TypeDefinitionMiddleware } from './typeDefinition';
import { DeclarationMiddleware } from './declaration';
import { WorkspaceFolderWorkspaceMiddleware } from './workspaceFolders';
import { SelectionRangeProviderMiddleware } from './selectionRange';
/**
 * An action to be performed when the connection is producing errors.
 */
export declare enum ErrorAction {
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
export declare enum CloseAction {
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
    error(error: Error, message: Message, count: number): ErrorAction;
    /**
     * The connection to the server got closed.
     */
    closed(): CloseAction;
}
export interface InitializationFailedHandler {
    (error: ResponseError<InitializeError> | Error | any): boolean;
}
export interface SynchronizeOptions {
    configurationSection?: string | string[];
    fileEvents?: FileWatcher | FileWatcher[];
}
export declare enum RevealOutputChannelOn {
    Info = 1,
    Warn = 2,
    Error = 3,
    Never = 4
}
export interface HandleDiagnosticsSignature {
    (uri: string, diagnostics: Diagnostic[]): void;
}
export interface ProvideCompletionItemsSignature {
    (document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken): ProviderResult<CompletionItem[] | CompletionList>;
}
export interface ResolveCompletionItemSignature {
    (item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>;
}
export interface ProvideHoverSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Hover>;
}
export interface ProvideSignatureHelpSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<SignatureHelp>;
}
export interface ProvideDefinitionSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition>;
}
export interface ProvideReferencesSignature {
    (document: TextDocument, position: Position, options: {
        includeDeclaration: boolean;
    }, token: CancellationToken): ProviderResult<Location[]>;
}
export interface ProvideDocumentHighlightsSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>;
}
export interface ProvideDocumentSymbolsSignature {
    (document: TextDocument, token: CancellationToken): ProviderResult<SymbolInformation[] | DocumentSymbol[]>;
}
export interface ProvideWorkspaceSymbolsSignature {
    (query: string, token: CancellationToken): ProviderResult<SymbolInformation[]>;
}
export interface ProvideCodeActionsSignature {
    (document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): ProviderResult<(Command | CodeAction)[]>;
}
export interface ProvideCodeLensesSignature {
    (document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>;
}
export interface ResolveCodeLensSignature {
    (codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>;
}
export interface ProvideDocumentFormattingEditsSignature {
    (document: TextDocument, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
export interface ProvideDocumentRangeFormattingEditsSignature {
    (document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
export interface ProvideOnTypeFormattingEditsSignature {
    (document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
export interface PrepareRenameSignature {
    (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Range | {
        range: Range;
        placeholder: string;
    }>;
}
export interface ProvideRenameEditsSignature {
    (document: TextDocument, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit>;
}
export interface ProvideDocumentLinksSignature {
    (document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]>;
}
export interface ResolveDocumentLinkSignature {
    (link: DocumentLink, token: CancellationToken): ProviderResult<DocumentLink>;
}
export interface NextSignature<P, R> {
    (this: void, data: P, next: (data: P) => R): R;
}
export interface DidChangeConfigurationSignature {
    (sections: string[] | undefined): void;
}
export interface _WorkspaceMiddleware {
    didChangeConfiguration?: (this: void, sections: string[] | undefined, next: DidChangeConfigurationSignature) => void;
}
export declare type WorkspaceMiddleware = _WorkspaceMiddleware & ConfigurationWorkspaceMiddleware & WorkspaceFolderWorkspaceMiddleware;
/**
 * The Middleware lets extensions intercept the request and notications send and received
 * from the server
 */
export interface _Middleware {
    didOpen?: NextSignature<TextDocument, void>;
    didChange?: NextSignature<DidChangeTextDocumentParams, void>;
    willSave?: NextSignature<TextDocumentWillSaveEvent, void>;
    willSaveWaitUntil?: NextSignature<TextDocumentWillSaveEvent, Thenable<TextEdit[]>>;
    didSave?: NextSignature<TextDocument, void>;
    didClose?: NextSignature<TextDocument, void>;
    handleDiagnostics?: (this: void, uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => void;
    provideCompletionItem?: (this: void, document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken, next: ProvideCompletionItemsSignature) => ProviderResult<CompletionItem[] | CompletionList>;
    resolveCompletionItem?: (this: void, item: CompletionItem, token: CancellationToken, next: ResolveCompletionItemSignature) => ProviderResult<CompletionItem>;
    provideHover?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideHoverSignature) => ProviderResult<Hover>;
    provideSignatureHelp?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideSignatureHelpSignature) => ProviderResult<SignatureHelp>;
    provideDefinition?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDefinitionSignature) => ProviderResult<Definition>;
    provideReferences?: (this: void, document: TextDocument, position: Position, options: {
        includeDeclaration: boolean;
    }, token: CancellationToken, next: ProvideReferencesSignature) => ProviderResult<Location[]>;
    provideDocumentHighlights?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDocumentHighlightsSignature) => ProviderResult<DocumentHighlight[]>;
    provideDocumentSymbols?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideDocumentSymbolsSignature) => ProviderResult<SymbolInformation[] | DocumentSymbol[]>;
    provideWorkspaceSymbols?: (this: void, query: string, token: CancellationToken, next: ProvideWorkspaceSymbolsSignature) => ProviderResult<SymbolInformation[]>;
    provideCodeActions?: (this: void, document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken, next: ProvideCodeActionsSignature) => ProviderResult<(Command | CodeAction)[]>;
    provideCodeLenses?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideCodeLensesSignature) => ProviderResult<CodeLens[]>;
    resolveCodeLens?: (this: void, codeLens: CodeLens, token: CancellationToken, next: ResolveCodeLensSignature) => ProviderResult<CodeLens>;
    provideDocumentFormattingEdits?: (this: void, document: TextDocument, options: FormattingOptions, token: CancellationToken, next: ProvideDocumentFormattingEditsSignature) => ProviderResult<TextEdit[]>;
    provideDocumentRangeFormattingEdits?: (this: void, document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken, next: ProvideDocumentRangeFormattingEditsSignature) => ProviderResult<TextEdit[]>;
    provideOnTypeFormattingEdits?: (this: void, document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken, next: ProvideOnTypeFormattingEditsSignature) => ProviderResult<TextEdit[]>;
    prepareRename?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: PrepareRenameSignature) => ProviderResult<Range | {
        range: Range;
        placeholder: string;
    }>;
    provideRenameEdits?: (this: void, document: TextDocument, position: Position, newName: string, token: CancellationToken, next: ProvideRenameEditsSignature) => ProviderResult<WorkspaceEdit>;
    provideDocumentLinks?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideDocumentLinksSignature) => ProviderResult<DocumentLink[]>;
    resolveDocumentLink?: (this: void, link: DocumentLink, token: CancellationToken, next: ResolveDocumentLinkSignature) => ProviderResult<DocumentLink>;
    workspace?: WorkspaceMiddleware;
}
export declare type Middleware = _Middleware & TypeDefinitionMiddleware & ImplementationMiddleware & ColorProviderMiddleware & DeclarationMiddleware & FoldingRangeProviderMiddleware & SelectionRangeProviderMiddleware;
export interface LanguageClientOptions {
    ignoredRootPaths?: string[];
    documentSelector?: DocumentSelector | string[];
    synchronize?: SynchronizeOptions;
    diagnosticCollectionName?: string;
    disableWorkspaceFolders?: boolean;
    disableDiagnostics?: boolean;
    disableCompletion?: boolean;
    outputChannelName?: string;
    outputChannel?: OutputChannel;
    revealOutputChannelOn?: RevealOutputChannelOn;
    /**
     * The encoding use to read stdout and stderr. Defaults
     * to 'utf8' if ommitted.
     */
    stdioEncoding?: string;
    initializationOptions?: any | (() => any);
    initializationFailedHandler?: InitializationFailedHandler;
    errorHandler?: ErrorHandler;
    middleware?: Middleware;
    workspaceFolder?: WorkspaceFolder;
}
export declare enum State {
    Stopped = 1,
    Running = 2,
    Starting = 3
}
export interface StateChangeEvent {
    oldState: State;
    newState: State;
}
export declare enum ClientState {
    Initial = 0,
    Starting = 1,
    StartFailed = 2,
    Running = 3,
    Stopping = 4,
    Stopped = 5
}
export interface RegistrationData<T> {
    id: string;
    registerOptions: T;
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
    fillInitializeParams?: (params: InitializeParams) => void;
    /**
     * Called to fill in the client capabilities this feature implements.
     *
     * @param capabilities The client capabilities to fill.
     */
    fillClientCapabilities(capabilities: ClientCapabilities): void;
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
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector | undefined): void;
}
export interface DynamicFeature<T> {
    /**
     * The message for which this features support dynamic activation / registration.
     */
    messages: RPCMessageType | RPCMessageType[];
    /**
     * Called to fill the initialize params.
     *
     * @params the initialize params.
     */
    fillInitializeParams?: (params: InitializeParams) => void;
    /**
     * Called to fill in the client capabilities this feature implements.
     *
     * @param capabilities The client capabilities to fill.
     */
    fillClientCapabilities(capabilities: ClientCapabilities): void;
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
    initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector | undefined): void;
    /**
     * Is called when the server send a register request for the given message.
     *
     * @param message the message to register for.
     * @param data additional registration data as defined in the protocol.
     */
    register(message: RPCMessageType, data: RegistrationData<T>): void;
    /**
     * Is called when the server wants to unregister a feature.
     *
     * @param id the id used when registering the feature.
     */
    unregister(id: string): void;
    /**
     * Called when the client is stopped to dispose this feature. Usually a feature
     * unregisters listeners registerd hooked up with the VS Code extension host.
     */
    dispose(): void;
}
export declare abstract class TextDocumentFeature<T extends TextDocumentRegistrationOptions> implements DynamicFeature<T> {
    protected _client: BaseLanguageClient;
    private _message;
    protected _providers: Map<string, Disposable>;
    constructor(_client: BaseLanguageClient, _message: RPCMessageType);
    readonly messages: RPCMessageType;
    abstract fillClientCapabilities(capabilities: ClientCapabilities): void;
    abstract initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void;
    register(message: RPCMessageType, data: RegistrationData<T>): void;
    protected abstract registerLanguageProvider(languageIds: T): Disposable;
    unregister(id: string): void;
    dispose(): void;
}
export interface MessageTransports {
    reader: MessageReader;
    writer: MessageWriter;
    detached?: boolean;
}
export declare namespace MessageTransports {
    function is(value: any): value is MessageTransports;
}
export declare abstract class BaseLanguageClient {
    private _id;
    private _name;
    private _clientOptions;
    protected _state: ClientState;
    private _onReady;
    private _onReadyCallbacks;
    private _onStop;
    private _connectionPromise;
    private _resolvedConnection;
    private _initializeResult;
    private _disposeOutputChannel;
    private _outputChannel;
    private _capabilities;
    private _listeners;
    private _providers;
    private _diagnostics;
    private _syncedDocuments;
    private _fileEvents;
    private _fileEventDelayer;
    private _stateChangeEmitter;
    private _traceFormat;
    private _trace;
    private _tracer;
    constructor(id: string, name: string, clientOptions: LanguageClientOptions);
    private state;
    readonly id: string;
    readonly name: string;
    getPublicState(): State;
    readonly initializeResult: InitializeResult | undefined;
    sendRequest<R, E, RO>(type: RequestType0<R, E, RO>, token?: CancellationToken): Thenable<R>;
    sendRequest<P, R, E, RO>(type: RequestType<P, R, E, RO>, params: P, token?: CancellationToken): Thenable<R>;
    sendRequest<R>(method: string, token?: CancellationToken): Thenable<R>;
    sendRequest<R>(method: string, param: any, token?: CancellationToken): Thenable<R>;
    onRequest<R, E, RO>(type: RequestType0<R, E, RO>, handler: RequestHandler0<R, E>): void;
    onRequest<P, R, E, RO>(type: RequestType<P, R, E, RO>, handler: RequestHandler<P, R, E>): void;
    onRequest<R, E>(method: string, handler: GenericRequestHandler<R, E>): void;
    sendNotification<RO>(type: NotificationType0<RO>): void;
    sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void;
    sendNotification(method: string): void;
    sendNotification(method: string, params: any): void;
    onNotification<RO>(type: NotificationType0<RO>, handler: NotificationHandler0): void;
    onNotification<P, RO>(type: NotificationType<P, RO>, handler: NotificationHandler<P>): void;
    onNotification(method: string, handler: GenericNotificationHandler): void;
    readonly clientOptions: LanguageClientOptions;
    readonly onDidChangeState: Event<StateChangeEvent>;
    readonly outputChannel: OutputChannel;
    readonly diagnostics: DiagnosticCollection | undefined;
    createDefaultErrorHandler(): ErrorHandler;
    trace: Trace;
    private logObjectTrace;
    private data2String;
    private _appendOutput;
    info(message: string, data?: any): void;
    warn(message: string, data?: any): void;
    error(message: string, data?: any): void;
    private logTrace;
    needsStart(): boolean;
    needsStop(): boolean;
    onReady(): Promise<void>;
    readonly started: boolean;
    private isConnectionActive;
    start(): Disposable;
    private resolveConnection;
    private resolveRootPath;
    private initialize;
    stop(): Thenable<void>;
    private cleanUp;
    private notifyFileEvent;
    private forceDocumentSync;
    private handleDiagnostics;
    private setDiagnostics;
    protected abstract createMessageTransports(encoding: string): Thenable<MessageTransports>;
    private createConnection;
    protected handleConnectionClosed(): void;
    restart(): void;
    private handleConnectionError;
    private hookConfigurationChanged;
    private refreshTrace;
    private hookFileEvents;
    private readonly _features;
    private readonly _method2Message;
    private readonly _dynamicFeatures;
    registerFeatures(features: (StaticFeature | DynamicFeature<any>)[]): void;
    registerFeature(feature: StaticFeature | DynamicFeature<any>): void;
    protected registerBuiltinFeatures(): void;
    private fillInitializeParams;
    private computeClientCapabilities;
    private initializeFeatures;
    private handleRegistrationRequest;
    private handleUnregistrationRequest;
    private handleApplyWorkspaceEdit;
    logFailedRequest(type: RPCMessageType, error: any): void;
}
