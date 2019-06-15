"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/*tslint:disable*/
const path_1 = tslib_1.__importDefault(require("path"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const commands_1 = tslib_1.__importDefault(require("../commands"));
const languages_1 = tslib_1.__importDefault(require("../languages"));
const fs_1 = require("../util/fs");
const Is = tslib_1.__importStar(require("../util/is"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const async_1 = require("./utils/async");
const cv = tslib_1.__importStar(require("./utils/converter"));
const UUID = tslib_1.__importStar(require("./utils/uuid"));
const logger = require('../util/logger')('language-client-client');
class ConsoleLogger {
    error(message) {
        logger.error(message);
    }
    warn(message) {
        logger.warn(message);
    }
    info(message) {
        logger.info(message);
    }
    log(message) {
        logger.log(message);
    }
}
function createConnection(input, output, errorHandler, closeHandler) {
    let logger = new ConsoleLogger();
    let connection = vscode_languageserver_protocol_1.createProtocolConnection(input, output, logger);
    connection.onError(data => {
        errorHandler(data[0], data[1], data[2]);
    });
    connection.onClose(closeHandler);
    let result = {
        listen: () => connection.listen(),
        sendRequest: (type, ...params) => connection.sendRequest(Is.string(type) ? type : type.method, ...params),
        onRequest: (type, handler) => connection.onRequest(Is.string(type) ? type : type.method, handler),
        sendNotification: (type, params) => connection.sendNotification(Is.string(type) ? type : type.method, params),
        onNotification: (type, handler) => connection.onNotification(Is.string(type) ? type : type.method, handler),
        trace: (value, tracer, sendNotificationOrTraceOptions) => {
            const defaultTraceOptions = {
                sendNotification: false,
                traceFormat: vscode_languageserver_protocol_1.TraceFormat.Text
            };
            if (sendNotificationOrTraceOptions === void 0) {
                connection.trace(value, tracer, defaultTraceOptions);
            }
            else if (Is.boolean(sendNotificationOrTraceOptions)) {
                connection.trace(value, tracer, sendNotificationOrTraceOptions);
            }
            else {
                connection.trace(value, tracer, sendNotificationOrTraceOptions);
            }
        },
        initialize: (params) => connection.sendRequest(vscode_languageserver_protocol_1.InitializeRequest.type, params),
        shutdown: () => connection.sendRequest(vscode_languageserver_protocol_1.ShutdownRequest.type, undefined),
        exit: () => connection.sendNotification(vscode_languageserver_protocol_1.ExitNotification.type),
        onLogMessage: (handler) => connection.onNotification(vscode_languageserver_protocol_1.LogMessageNotification.type, handler),
        onShowMessage: (handler) => connection.onNotification(vscode_languageserver_protocol_1.ShowMessageNotification.type, handler),
        onTelemetry: (handler) => connection.onNotification(vscode_languageserver_protocol_1.TelemetryEventNotification.type, handler),
        didChangeConfiguration: (params) => connection.sendNotification(vscode_languageserver_protocol_1.DidChangeConfigurationNotification.type, params),
        didChangeWatchedFiles: (params) => connection.sendNotification(vscode_languageserver_protocol_1.DidChangeWatchedFilesNotification.type, params),
        didOpenTextDocument: (params) => connection.sendNotification(vscode_languageserver_protocol_1.DidOpenTextDocumentNotification.type, params),
        didChangeTextDocument: (params) => connection.sendNotification(vscode_languageserver_protocol_1.DidChangeTextDocumentNotification.type, params),
        didCloseTextDocument: (params) => connection.sendNotification(vscode_languageserver_protocol_1.DidCloseTextDocumentNotification.type, params),
        didSaveTextDocument: (params) => connection.sendNotification(vscode_languageserver_protocol_1.DidSaveTextDocumentNotification.type, params),
        onDiagnostics: (handler) => connection.onNotification(vscode_languageserver_protocol_1.PublishDiagnosticsNotification.type, handler),
        dispose: () => connection.dispose()
    };
    return result;
}
/**
 * An action to be performed when the connection is producing errors.
 */
var ErrorAction;
(function (ErrorAction) {
    /**
     * Continue running the server.
     */
    ErrorAction[ErrorAction["Continue"] = 1] = "Continue";
    /**
     * Shutdown the server.
     */
    ErrorAction[ErrorAction["Shutdown"] = 2] = "Shutdown";
})(ErrorAction = exports.ErrorAction || (exports.ErrorAction = {}));
/**
 * An action to be performed when the connection to a server got closed.
 */
var CloseAction;
(function (CloseAction) {
    /**
     * Don't restart the server. The connection stays closed.
     */
    CloseAction[CloseAction["DoNotRestart"] = 1] = "DoNotRestart";
    /**
     * Restart the server.
     */
    CloseAction[CloseAction["Restart"] = 2] = "Restart";
})(CloseAction = exports.CloseAction || (exports.CloseAction = {}));
class DefaultErrorHandler {
    constructor(name) {
        this.name = name;
        this.restarts = [];
    }
    error(_error, _message, count) {
        if (count && count <= 3) {
            return ErrorAction.Continue;
        }
        return ErrorAction.Shutdown;
    }
    closed() {
        this.restarts.push(Date.now());
        if (this.restarts.length < 5) {
            return CloseAction.Restart;
        }
        else {
            let diff = this.restarts[this.restarts.length - 1] - this.restarts[0];
            if (diff <= 3 * 60 * 1000) {
                logger.error(`The ${this.name} server crashed 5 times in the last 3 minutes. The server will not be restarted.`);
                return CloseAction.DoNotRestart;
            }
            else {
                this.restarts.shift();
                return CloseAction.Restart;
            }
        }
    }
}
var RevealOutputChannelOn;
(function (RevealOutputChannelOn) {
    RevealOutputChannelOn[RevealOutputChannelOn["Info"] = 1] = "Info";
    RevealOutputChannelOn[RevealOutputChannelOn["Warn"] = 2] = "Warn";
    RevealOutputChannelOn[RevealOutputChannelOn["Error"] = 3] = "Error";
    RevealOutputChannelOn[RevealOutputChannelOn["Never"] = 4] = "Never";
})(RevealOutputChannelOn = exports.RevealOutputChannelOn || (exports.RevealOutputChannelOn = {}));
var State;
(function (State) {
    State[State["Stopped"] = 1] = "Stopped";
    State[State["Running"] = 2] = "Running";
    State[State["Starting"] = 3] = "Starting";
})(State = exports.State || (exports.State = {}));
var ClientState;
(function (ClientState) {
    ClientState[ClientState["Initial"] = 0] = "Initial";
    ClientState[ClientState["Starting"] = 1] = "Starting";
    ClientState[ClientState["StartFailed"] = 2] = "StartFailed";
    ClientState[ClientState["Running"] = 3] = "Running";
    ClientState[ClientState["Stopping"] = 4] = "Stopping";
    ClientState[ClientState["Stopped"] = 5] = "Stopped";
})(ClientState = exports.ClientState || (exports.ClientState = {}));
const SupporedSymbolKinds = [
    vscode_languageserver_protocol_1.SymbolKind.File,
    vscode_languageserver_protocol_1.SymbolKind.Module,
    vscode_languageserver_protocol_1.SymbolKind.Namespace,
    vscode_languageserver_protocol_1.SymbolKind.Package,
    vscode_languageserver_protocol_1.SymbolKind.Class,
    vscode_languageserver_protocol_1.SymbolKind.Method,
    vscode_languageserver_protocol_1.SymbolKind.Property,
    vscode_languageserver_protocol_1.SymbolKind.Field,
    vscode_languageserver_protocol_1.SymbolKind.Constructor,
    vscode_languageserver_protocol_1.SymbolKind.Enum,
    vscode_languageserver_protocol_1.SymbolKind.Interface,
    vscode_languageserver_protocol_1.SymbolKind.Function,
    vscode_languageserver_protocol_1.SymbolKind.Variable,
    vscode_languageserver_protocol_1.SymbolKind.Constant,
    vscode_languageserver_protocol_1.SymbolKind.String,
    vscode_languageserver_protocol_1.SymbolKind.Number,
    vscode_languageserver_protocol_1.SymbolKind.Boolean,
    vscode_languageserver_protocol_1.SymbolKind.Array,
    vscode_languageserver_protocol_1.SymbolKind.Object,
    vscode_languageserver_protocol_1.SymbolKind.Key,
    vscode_languageserver_protocol_1.SymbolKind.Null,
    vscode_languageserver_protocol_1.SymbolKind.EnumMember,
    vscode_languageserver_protocol_1.SymbolKind.Struct,
    vscode_languageserver_protocol_1.SymbolKind.Event,
    vscode_languageserver_protocol_1.SymbolKind.Operator,
    vscode_languageserver_protocol_1.SymbolKind.TypeParameter
];
const SupportedCompletionItemKinds = [
    vscode_languageserver_protocol_1.CompletionItemKind.Text,
    vscode_languageserver_protocol_1.CompletionItemKind.Method,
    vscode_languageserver_protocol_1.CompletionItemKind.Function,
    vscode_languageserver_protocol_1.CompletionItemKind.Constructor,
    vscode_languageserver_protocol_1.CompletionItemKind.Field,
    vscode_languageserver_protocol_1.CompletionItemKind.Variable,
    vscode_languageserver_protocol_1.CompletionItemKind.Class,
    vscode_languageserver_protocol_1.CompletionItemKind.Interface,
    vscode_languageserver_protocol_1.CompletionItemKind.Module,
    vscode_languageserver_protocol_1.CompletionItemKind.Property,
    vscode_languageserver_protocol_1.CompletionItemKind.Unit,
    vscode_languageserver_protocol_1.CompletionItemKind.Value,
    vscode_languageserver_protocol_1.CompletionItemKind.Enum,
    vscode_languageserver_protocol_1.CompletionItemKind.Keyword,
    vscode_languageserver_protocol_1.CompletionItemKind.Snippet,
    vscode_languageserver_protocol_1.CompletionItemKind.Color,
    vscode_languageserver_protocol_1.CompletionItemKind.File,
    vscode_languageserver_protocol_1.CompletionItemKind.Reference,
    vscode_languageserver_protocol_1.CompletionItemKind.Folder,
    vscode_languageserver_protocol_1.CompletionItemKind.EnumMember,
    vscode_languageserver_protocol_1.CompletionItemKind.Constant,
    vscode_languageserver_protocol_1.CompletionItemKind.Struct,
    vscode_languageserver_protocol_1.CompletionItemKind.Event,
    vscode_languageserver_protocol_1.CompletionItemKind.Operator,
    vscode_languageserver_protocol_1.CompletionItemKind.TypeParameter
];
function ensure(target, key) {
    if (target[key] == null) {
        target[key] = {};
    }
    return target[key];
}
var DynamicFeature;
(function (DynamicFeature) {
    function is(value) {
        let candidate = value;
        return (candidate &&
            Is.func(candidate.register) &&
            Is.func(candidate.unregister) &&
            Is.func(candidate.dispose) &&
            candidate.messages != null);
    }
    DynamicFeature.is = is;
})(DynamicFeature || (DynamicFeature = {}));
class OnReady {
    constructor(_resolve, _reject) {
        this._resolve = _resolve;
        this._reject = _reject;
        this._used = false;
    }
    get isUsed() {
        return this._used;
    }
    resolve() {
        this._used = true;
        this._resolve();
    }
    reject(error) {
        this._used = true;
        this._reject(error);
    }
}
class DocumentNotifiactions {
    constructor(_client, _event, _type, _middleware, _createParams, _selectorFilter) {
        this._client = _client;
        this._event = _event;
        this._type = _type;
        this._middleware = _middleware;
        this._createParams = _createParams;
        this._selectorFilter = _selectorFilter;
        this._selectors = new Map();
    }
    static textDocumentFilter(selectors, textDocument) {
        for (const selector of selectors) {
            if (workspace_1.default.match(selector, textDocument) > 0) {
                return true;
            }
        }
        return false;
    }
    register(_message, data) {
        if (!data.registerOptions.documentSelector) {
            return;
        }
        if (!this._listener) {
            this._listener = this._event(this.callback, this);
        }
        this._selectors.set(data.id, data.registerOptions.documentSelector);
    }
    callback(data) {
        if (!this._selectorFilter ||
            this._selectorFilter(this._selectors.values(), data)) {
            if (this._middleware) {
                this._middleware(data, data => this._client.sendNotification(this._type, this._createParams(data)));
            }
            else {
                this._client.sendNotification(this._type, this._createParams(data));
            }
            this.notificationSent(data);
        }
    }
    notificationSent(_data) { }
    unregister(id) {
        this._selectors.delete(id);
        if (this._selectors.size === 0 && this._listener) {
            this._listener.dispose();
            this._listener = undefined;
        }
    }
    dispose() {
        this._selectors.clear();
        if (this._listener) {
            this._listener.dispose();
            this._listener = undefined;
        }
    }
}
class DidOpenTextDocumentFeature extends DocumentNotifiactions {
    constructor(client, _syncedDocuments) {
        super(client, workspace_1.default.onDidOpenTextDocument, vscode_languageserver_protocol_1.DidOpenTextDocumentNotification.type, client.clientOptions.middleware.didOpen, (textDocument) => {
            return { textDocument: cv.convertToTextDocumentItem(textDocument) };
        }, DocumentNotifiactions.textDocumentFilter);
        this._syncedDocuments = _syncedDocuments;
    }
    get messages() {
        return vscode_languageserver_protocol_1.DidOpenTextDocumentNotification.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'textDocument'), 'synchronization').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        let textDocumentSyncOptions = capabilities.resolvedTextDocumentSync;
        if (documentSelector &&
            textDocumentSyncOptions &&
            textDocumentSyncOptions.openClose) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: { documentSelector: documentSelector }
            });
        }
    }
    register(message, data) {
        super.register(message, data);
        if (!data.registerOptions.documentSelector) {
            return;
        }
        let documentSelector = data.registerOptions.documentSelector;
        workspace_1.default.textDocuments.forEach(textDocument => {
            let uri = textDocument.uri.toString();
            if (this._syncedDocuments.has(uri)) {
                return;
            }
            if (workspace_1.default.match(documentSelector, textDocument) > 0) {
                let middleware = this._client.clientOptions.middleware;
                let didOpen = (textDocument) => {
                    this._client.sendNotification(this._type, this._createParams(textDocument));
                };
                if (middleware.didOpen) {
                    middleware.didOpen(textDocument, didOpen);
                }
                else {
                    didOpen(textDocument);
                }
                this._syncedDocuments.set(uri, textDocument);
            }
        });
    }
    notificationSent(textDocument) {
        super.notificationSent(textDocument);
        this._syncedDocuments.set(textDocument.uri.toString(), textDocument);
    }
}
class DidCloseTextDocumentFeature extends DocumentNotifiactions {
    constructor(client, _syncedDocuments) {
        super(client, workspace_1.default.onDidCloseTextDocument, vscode_languageserver_protocol_1.DidCloseTextDocumentNotification.type, client.clientOptions.middleware.didClose, (textDocument) => cv.asCloseTextDocumentParams(textDocument), DocumentNotifiactions.textDocumentFilter);
        this._syncedDocuments = _syncedDocuments;
    }
    get messages() {
        return vscode_languageserver_protocol_1.DidCloseTextDocumentNotification.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'textDocument'), 'synchronization').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        let textDocumentSyncOptions = capabilities.resolvedTextDocumentSync;
        if (documentSelector &&
            textDocumentSyncOptions &&
            textDocumentSyncOptions.openClose) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: { documentSelector: documentSelector }
            });
        }
    }
    notificationSent(textDocument) {
        super.notificationSent(textDocument);
        this._syncedDocuments.delete(textDocument.uri.toString());
    }
    unregister(id) {
        let selector = this._selectors.get(id);
        // The super call removed the selector from the map
        // of selectors.
        super.unregister(id);
        let selectors = this._selectors.values();
        this._syncedDocuments.forEach(textDocument => {
            if (workspace_1.default.match(selector, textDocument) > 0 &&
                !this._selectorFilter(selectors, textDocument)) {
                let middleware = this._client.clientOptions.middleware;
                let didClose = (textDocument) => {
                    this._client.sendNotification(this._type, this._createParams(textDocument));
                };
                this._syncedDocuments.delete(textDocument.uri.toString());
                if (middleware.didClose) {
                    middleware.didClose(textDocument, didClose);
                }
                else {
                    didClose(textDocument);
                }
            }
        });
    }
}
class DidChangeTextDocumentFeature {
    constructor(_client) {
        this._client = _client;
        this._changeData = new Map();
    }
    get messages() {
        return vscode_languageserver_protocol_1.DidChangeTextDocumentNotification.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'textDocument'), 'synchronization').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        let textDocumentSyncOptions = capabilities.resolvedTextDocumentSync;
        if (documentSelector &&
            textDocumentSyncOptions &&
            textDocumentSyncOptions.change != null &&
            textDocumentSyncOptions.change !== vscode_languageserver_protocol_1.TextDocumentSyncKind.None) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: Object.assign({}, { documentSelector: documentSelector }, { syncKind: textDocumentSyncOptions.change })
            });
        }
    }
    register(_message, data) {
        if (!data.registerOptions.documentSelector) {
            return;
        }
        if (!this._listener) {
            this._listener = workspace_1.default.onDidChangeTextDocument(this.callback, this);
        }
        this._changeData.set(data.id, {
            documentSelector: data.registerOptions.documentSelector,
            syncKind: data.registerOptions.syncKind
        });
    }
    callback(event) {
        // Text document changes are send for dirty changes as well. We don't
        // have dirty / undirty events in the LSP so we ignore content changes
        // with length zero.
        if (event.contentChanges.length === 0) {
            return;
        }
        let doc = workspace_1.default.getDocument(event.textDocument.uri);
        if (!doc)
            return;
        let { textDocument } = doc;
        for (const changeData of this._changeData.values()) {
            if (workspace_1.default.match(changeData.documentSelector, textDocument) > 0) {
                let middleware = this._client.clientOptions.middleware;
                if (changeData.syncKind === vscode_languageserver_protocol_1.TextDocumentSyncKind.Incremental) {
                    if (middleware.didChange) {
                        middleware.didChange(event, () => this._client.sendNotification(vscode_languageserver_protocol_1.DidChangeTextDocumentNotification.type, event));
                    }
                    else {
                        this._client.sendNotification(vscode_languageserver_protocol_1.DidChangeTextDocumentNotification.type, event);
                    }
                }
                else if (changeData.syncKind === vscode_languageserver_protocol_1.TextDocumentSyncKind.Full) {
                    let didChange = event => {
                        let { textDocument } = workspace_1.default.getDocument(event.textDocument.uri);
                        this._client.sendNotification(vscode_languageserver_protocol_1.DidChangeTextDocumentNotification.type, cv.asChangeTextDocumentParams(textDocument));
                    };
                    if (middleware.didChange) {
                        middleware.didChange(event, didChange);
                    }
                    else {
                        didChange(event);
                    }
                }
            }
        }
    }
    unregister(id) {
        this._changeData.delete(id);
        if (this._changeData.size === 0 && this._listener) {
            this._listener.dispose();
            this._listener = undefined;
        }
    }
    dispose() {
        this._changeData.clear();
        if (this._listener) {
            this._listener.dispose();
            this._listener = undefined;
        }
    }
}
class WillSaveFeature extends DocumentNotifiactions {
    constructor(client) {
        super(client, workspace_1.default.onWillSaveTextDocument, vscode_languageserver_protocol_1.WillSaveTextDocumentNotification.type, client.clientOptions.middleware.willSave, willSaveEvent => cv.asWillSaveTextDocumentParams(willSaveEvent), (selectors, willSaveEvent) => DocumentNotifiactions.textDocumentFilter(selectors, willSaveEvent.document));
    }
    get messages() {
        return vscode_languageserver_protocol_1.WillSaveTextDocumentNotification.type;
    }
    fillClientCapabilities(capabilities) {
        let value = ensure(ensure(capabilities, 'textDocument'), 'synchronization');
        value.willSave = true;
    }
    initialize(capabilities, documentSelector) {
        let textDocumentSyncOptions = capabilities.resolvedTextDocumentSync;
        if (documentSelector &&
            textDocumentSyncOptions &&
            textDocumentSyncOptions.willSave) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: { documentSelector: documentSelector }
            });
        }
    }
}
class WillSaveWaitUntilFeature {
    constructor(_client) {
        this._client = _client;
        this._selectors = new Map();
    }
    get messages() {
        return vscode_languageserver_protocol_1.WillSaveTextDocumentWaitUntilRequest.type;
    }
    fillClientCapabilities(capabilities) {
        let value = ensure(ensure(capabilities, 'textDocument'), 'synchronization');
        value.willSaveWaitUntil = true;
    }
    initialize(capabilities, documentSelector) {
        let textDocumentSyncOptions = capabilities.resolvedTextDocumentSync;
        if (documentSelector &&
            textDocumentSyncOptions &&
            textDocumentSyncOptions.willSaveWaitUntil) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: { documentSelector: documentSelector }
            });
        }
    }
    register(_message, data) {
        if (!data.registerOptions.documentSelector) {
            return;
        }
        if (!this._listener) {
            this._listener = workspace_1.default.onWillSaveUntil(this.callback, this, this._client.id);
        }
        this._selectors.set(data.id, data.registerOptions.documentSelector);
    }
    callback(event) {
        if (DocumentNotifiactions.textDocumentFilter(this._selectors.values(), event.document)) {
            let middleware = this._client.clientOptions.middleware;
            let willSaveWaitUntil = (event) => {
                return this._client
                    .sendRequest(vscode_languageserver_protocol_1.WillSaveTextDocumentWaitUntilRequest.type, cv.asWillSaveTextDocumentParams(event))
                    .then(edits => {
                    return edits ? edits : [];
                }, e => {
                    workspace_1.default.showMessage(`Error on willSaveWaitUntil: ${e}`, 'error');
                    logger.error(e);
                    return [];
                });
            };
            event.waitUntil(middleware.willSaveWaitUntil
                ? middleware.willSaveWaitUntil(event, willSaveWaitUntil)
                : willSaveWaitUntil(event));
        }
    }
    unregister(id) {
        this._selectors.delete(id);
        if (this._selectors.size === 0 && this._listener) {
            this._listener.dispose();
            this._listener = undefined;
        }
    }
    dispose() {
        this._selectors.clear();
        if (this._listener) {
            this._listener.dispose();
            this._listener = undefined;
        }
    }
}
class DidSaveTextDocumentFeature extends DocumentNotifiactions {
    constructor(client) {
        super(client, workspace_1.default.onDidSaveTextDocument, vscode_languageserver_protocol_1.DidSaveTextDocumentNotification.type, client.clientOptions.middleware.didSave, textDocument => cv.asSaveTextDocumentParams(textDocument, this._includeText), DocumentNotifiactions.textDocumentFilter);
    }
    get messages() {
        return vscode_languageserver_protocol_1.DidSaveTextDocumentNotification.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'textDocument'), 'synchronization').didSave = true;
    }
    initialize(capabilities, documentSelector) {
        let textDocumentSyncOptions = capabilities.resolvedTextDocumentSync;
        if (documentSelector &&
            textDocumentSyncOptions &&
            textDocumentSyncOptions.save) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: Object.assign({}, { documentSelector: documentSelector }, { includeText: !!textDocumentSyncOptions.save.includeText })
            });
        }
    }
    register(method, data) {
        this._includeText = !!data.registerOptions.includeText;
        super.register(method, data);
    }
}
class FileSystemWatcherFeature {
    constructor(_client, _notifyFileEvent) {
        this._notifyFileEvent = _notifyFileEvent;
        this._watchers = new Map();
    }
    get messages() {
        return vscode_languageserver_protocol_1.DidChangeWatchedFilesNotification.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'workspace'), 'didChangeWatchedFiles').dynamicRegistration = true;
    }
    initialize(_capabilities, _documentSelector) { }
    register(_method, data) {
        if (!Array.isArray(data.registerOptions.watchers)) {
            return;
        }
        let disposables = [];
        for (let watcher of data.registerOptions.watchers) {
            if (!Is.string(watcher.globPattern)) {
                continue;
            }
            let watchCreate = true, watchChange = true, watchDelete = true;
            if (watcher.kind != null) {
                watchCreate = (watcher.kind & vscode_languageserver_protocol_1.WatchKind.Create) !== 0;
                watchChange = (watcher.kind & vscode_languageserver_protocol_1.WatchKind.Change) != 0;
                watchDelete = (watcher.kind & vscode_languageserver_protocol_1.WatchKind.Delete) != 0;
            }
            let fileSystemWatcher = workspace_1.default.createFileSystemWatcher(watcher.globPattern, !watchCreate, !watchChange, !watchDelete);
            this.hookListeners(fileSystemWatcher, watchCreate, watchChange, watchDelete, disposables);
            disposables.push(fileSystemWatcher);
        }
        this._watchers.set(data.id, disposables);
    }
    registerRaw(id, fileSystemWatchers) {
        let disposables = [];
        for (let fileSystemWatcher of fileSystemWatchers) {
            disposables.push(fileSystemWatcher);
            this.hookListeners(fileSystemWatcher, true, true, true, disposables);
        }
        this._watchers.set(id, disposables);
    }
    hookListeners(fileSystemWatcher, watchCreate, watchChange, watchDelete, listeners) {
        if (watchCreate) {
            fileSystemWatcher.onDidCreate(resource => this._notifyFileEvent({
                uri: cv.asUri(resource),
                type: vscode_languageserver_protocol_1.FileChangeType.Created
            }), null, listeners);
        }
        if (watchChange) {
            fileSystemWatcher.onDidChange(resource => this._notifyFileEvent({
                uri: cv.asUri(resource),
                type: vscode_languageserver_protocol_1.FileChangeType.Changed
            }), null, listeners);
        }
        if (watchDelete) {
            fileSystemWatcher.onDidDelete(resource => this._notifyFileEvent({
                uri: cv.asUri(resource),
                type: vscode_languageserver_protocol_1.FileChangeType.Deleted
            }), null, listeners);
        }
    }
    unregister(id) {
        let disposables = this._watchers.get(id);
        if (disposables) {
            for (let disposable of disposables) {
                disposable.dispose();
            }
        }
    }
    dispose() {
        this._watchers.forEach(disposables => {
            for (let disposable of disposables) {
                disposable.dispose();
            }
        });
        this._watchers.clear();
    }
}
class TextDocumentFeature {
    constructor(_client, _message) {
        this._client = _client;
        this._message = _message;
        this._providers = new Map();
    }
    get messages() {
        return this._message;
    }
    register(message, data) {
        if (message.method !== this.messages.method) {
            throw new Error(`Register called on wrong feature. Requested ${message.method} but reached feature ${this.messages.method}`);
        }
        if (!data.registerOptions.documentSelector) {
            return;
        }
        let provider = this.registerLanguageProvider(data.registerOptions);
        if (provider) {
            this._providers.set(data.id, provider);
        }
    }
    unregister(id) {
        let provider = this._providers.get(id);
        if (provider) {
            provider.dispose();
        }
    }
    dispose() {
        this._providers.forEach(value => {
            value.dispose();
        });
        this._providers.clear();
    }
}
exports.TextDocumentFeature = TextDocumentFeature;
class WorkspaceFeature {
    constructor(_client, _message) {
        this._client = _client;
        this._message = _message;
        this._providers = new Map();
    }
    get messages() {
        return this._message;
    }
    register(message, data) {
        if (message.method !== this.messages.method) {
            throw new Error(`Register called on wrong feature. Requested ${message.method} but reached feature ${this.messages.method}`);
        }
        let provider = this.registerLanguageProvider(data.registerOptions);
        if (provider) {
            this._providers.set(data.id, provider);
        }
    }
    unregister(id) {
        let provider = this._providers.get(id);
        if (provider) {
            provider.dispose();
        }
    }
    dispose() {
        this._providers.forEach(value => {
            value.dispose();
        });
        this._providers.clear();
    }
}
class CompletionItemFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.CompletionRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let completion = ensure(ensure(capabilites, 'textDocument'), 'completion');
        completion.dynamicRegistration = true;
        completion.contextSupport = true;
        completion.completionItem = {
            snippetSupport: true,
            commitCharactersSupport: true,
            documentationFormat: [vscode_languageserver_protocol_1.MarkupKind.Markdown, vscode_languageserver_protocol_1.MarkupKind.PlainText],
            deprecatedSupport: true,
            preselectSupport: true
        };
        completion.completionItemKind = { valueSet: SupportedCompletionItemKinds };
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.completionProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector }, capabilities.completionProvider)
        });
    }
    registerLanguageProvider(options) {
        let triggerCharacters = options.triggerCharacters || [];
        let client = this._client;
        let provideCompletionItems = (document, position, context, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.CompletionRequest.type, cv.asCompletionParams(document, position, context), token)
                .then(result => {
                // logger.debug('result', result)
                return result;
            }, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.CompletionRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let resolveCompletionItem = (item, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.CompletionResolveRequest.type, item, token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.CompletionResolveRequest.type, error);
                return Promise.resolve(item);
            });
        };
        let middleware = this._client.clientOptions.middleware;
        let languageIds = cv.asLanguageIds(options.documentSelector);
        return languages_1.default.registerCompletionItemProvider(this._client.id, 'LS', languageIds, {
            provideCompletionItems: (document, position, token, context) => {
                return middleware.provideCompletionItem
                    ? middleware.provideCompletionItem(document, position, context, token, provideCompletionItems)
                    : provideCompletionItems(document, position, context, token);
            },
            resolveCompletionItem: options.resolveProvider
                ? (item, token) => {
                    return middleware.resolveCompletionItem
                        ? middleware.resolveCompletionItem(item, token, resolveCompletionItem)
                        : resolveCompletionItem(item, token);
                }
                : undefined
        }, triggerCharacters);
    }
}
class HoverFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.HoverRequest.type);
    }
    fillClientCapabilities(capabilites) {
        const hoverCapability = ensure(ensure(capabilites, 'textDocument'), 'hover');
        hoverCapability.dynamicRegistration = true;
        hoverCapability.contentFormat = [vscode_languageserver_protocol_1.MarkupKind.Markdown, vscode_languageserver_protocol_1.MarkupKind.PlainText];
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.hoverProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideHover = (document, position, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.HoverRequest.type, cv.asTextDocumentPositionParams(document, position), token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.HoverRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerHoverProvider(options.documentSelector, {
            provideHover: (document, position, token) => {
                return middleware.provideHover
                    ? middleware.provideHover(document, position, token, provideHover)
                    : provideHover(document, position, token);
            }
        });
    }
}
class SignatureHelpFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.SignatureHelpRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let config = ensure(ensure(capabilites, 'textDocument'), 'signatureHelp');
        config.dynamicRegistration = true;
        config.signatureInformation = {
            documentationFormat: [vscode_languageserver_protocol_1.MarkupKind.Markdown, vscode_languageserver_protocol_1.MarkupKind.PlainText],
            parameterInformation: {
                labelOffsetSupport: true
            }
        };
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.signatureHelpProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector }, capabilities.signatureHelpProvider)
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let providerSignatureHelp = (document, position, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.SignatureHelpRequest.type, cv.asTextDocumentPositionParams(document, position), token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.SignatureHelpRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let middleware = client.clientOptions.middleware;
        let triggerCharacters = options.triggerCharacters || [];
        return languages_1.default.registerSignatureHelpProvider(options.documentSelector, {
            provideSignatureHelp: (document, position, token) => {
                return middleware.provideSignatureHelp
                    ? middleware.provideSignatureHelp(document, position, token, providerSignatureHelp)
                    : providerSignatureHelp(document, position, token);
            }
        }, triggerCharacters);
    }
}
class DefinitionFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DefinitionRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let definitionSupport = ensure(ensure(capabilites, 'textDocument'), 'definition');
        definitionSupport.dynamicRegistration = true;
        // definitionSupport.linkSupport = true
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.definitionProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDefinition = (document, position, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.DefinitionRequest.type, cv.asTextDocumentPositionParams(document, position), token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DefinitionRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDefinitionProvider(options.documentSelector, {
            provideDefinition: (document, position, token) => {
                return middleware.provideDefinition
                    ? middleware.provideDefinition(document, position, token, provideDefinition)
                    : provideDefinition(document, position, token);
            }
        });
    }
}
class ReferencesFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.ReferencesRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'references').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.referencesProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let providerReferences = (document, position, options, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.ReferencesRequest.type, cv.asReferenceParams(document, position, options), token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.ReferencesRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerReferencesProvider(options.documentSelector, {
            provideReferences: (document, position, options, token) => {
                return middleware.provideReferences
                    ? middleware.provideReferences(document, position, options, token, providerReferences)
                    : providerReferences(document, position, options, token);
            }
        });
    }
}
class DocumentHighlightFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentHighlightRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'documentHighlight').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.documentHighlightProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDocumentHighlights = (document, position, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.DocumentHighlightRequest.type, cv.asTextDocumentPositionParams(document, position), token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentHighlightRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDocumentHighlightProvider(options.documentSelector, {
            provideDocumentHighlights: (document, position, token) => {
                return middleware.provideDocumentHighlights
                    ? middleware.provideDocumentHighlights(document, position, token, provideDocumentHighlights)
                    : provideDocumentHighlights(document, position, token);
            }
        });
    }
}
class DocumentSymbolFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentSymbolRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let symbolCapabilities = ensure(ensure(capabilites, 'textDocument'), 'documentSymbol');
        symbolCapabilities.dynamicRegistration = true;
        symbolCapabilities.symbolKind = {
            valueSet: SupporedSymbolKinds
        };
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.documentSymbolProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDocumentSymbols = (document, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.DocumentSymbolRequest.type, cv.asDocumentSymbolParams(document), token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentSymbolRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDocumentSymbolProvider(options.documentSelector, {
            provideDocumentSymbols: (document, token) => {
                return middleware.provideDocumentSymbols
                    ? middleware.provideDocumentSymbols(document, token, provideDocumentSymbols)
                    : provideDocumentSymbols(document, token);
            }
        });
    }
}
class WorkspaceSymbolFeature extends WorkspaceFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.WorkspaceSymbolRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let symbolCapabilities = ensure(ensure(capabilites, 'workspace'), 'symbol');
        symbolCapabilities.dynamicRegistration = true;
        symbolCapabilities.symbolKind = {
            valueSet: SupporedSymbolKinds
        };
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.workspaceSymbolProvider) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideWorkspaceSymbols = (query, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.WorkspaceSymbolRequest.type, { query }, token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.WorkspaceSymbolRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerWorkspaceSymbolProvider(options.documentSelector, {
            provideWorkspaceSymbols: (query, token) => {
                return middleware.provideWorkspaceSymbols
                    ? middleware.provideWorkspaceSymbols(query, token, provideWorkspaceSymbols)
                    : provideWorkspaceSymbols(query, token);
            }
        });
    }
}
class CodeActionFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.CodeActionRequest.type);
    }
    fillClientCapabilities(capabilites) {
        const cap = ensure(ensure(capabilites, 'textDocument'), 'codeAction');
        cap.dynamicRegistration = true;
        cap.codeActionLiteralSupport = {
            codeActionKind: {
                valueSet: [
                    '',
                    vscode_languageserver_protocol_1.CodeActionKind.QuickFix,
                    vscode_languageserver_protocol_1.CodeActionKind.Refactor,
                    vscode_languageserver_protocol_1.CodeActionKind.RefactorExtract,
                    vscode_languageserver_protocol_1.CodeActionKind.RefactorInline,
                    vscode_languageserver_protocol_1.CodeActionKind.RefactorRewrite,
                    vscode_languageserver_protocol_1.CodeActionKind.Source,
                    vscode_languageserver_protocol_1.CodeActionKind.SourceOrganizeImports
                ]
            }
        };
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.codeActionProvider || !documentSelector) {
            return;
        }
        let codeActionKinds;
        if (!Is.boolean(capabilities.codeActionProvider)) {
            codeActionKinds = capabilities.codeActionProvider.codeActionKinds;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector, codeActionKinds })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideCodeActions = (document, range, context, token) => {
            let params = {
                textDocument: {
                    uri: document.uri
                },
                range,
                context,
            };
            return client.sendRequest(vscode_languageserver_protocol_1.CodeActionRequest.type, params, token).then(values => {
                if (values == null)
                    return null;
                return values;
            }, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.CodeActionRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerCodeActionProvider(options.documentSelector, {
            provideCodeActions: (document, range, context, token) => {
                return middleware.provideCodeActions
                    ? middleware.provideCodeActions(document, range, context, token, provideCodeActions)
                    : provideCodeActions(document, range, context, token);
            }
        }, client.id, options.codeActionKinds);
    }
}
class CodeLensFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.CodeLensRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'codeLens').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.codeLensProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector }, capabilities.codeLensProvider)
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideCodeLenses = (document, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.CodeLensRequest.type, cv.asCodeLensParams(document), token).then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.CodeLensRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let resolveCodeLens = (codeLens, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.CodeLensResolveRequest.type, codeLens, token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.CodeLensResolveRequest.type, error);
                return codeLens;
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerCodeLensProvider(options.documentSelector, {
            provideCodeLenses: (document, token) => {
                return middleware.provideCodeLenses
                    ? middleware.provideCodeLenses(document, token, provideCodeLenses)
                    : provideCodeLenses(document, token);
            },
            resolveCodeLens: options.resolveProvider
                ? (codeLens, token) => {
                    return middleware.resolveCodeLens
                        ? middleware.resolveCodeLens(codeLens, token, resolveCodeLens)
                        : resolveCodeLens(codeLens, token);
                }
                : undefined
        });
    }
}
class DocumentFormattingFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentFormattingRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'formatting').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.documentFormattingProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDocumentFormattingEdits = (document, options, token) => {
            let params = {
                textDocument: {
                    uri: document.uri
                },
                options
            };
            return client
                .sendRequest(vscode_languageserver_protocol_1.DocumentFormattingRequest.type, params, token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentFormattingRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDocumentFormatProvider(options.documentSelector, {
            provideDocumentFormattingEdits: (document, options, token) => {
                return middleware.provideDocumentFormattingEdits
                    ? middleware.provideDocumentFormattingEdits(document, options, token, provideDocumentFormattingEdits)
                    : provideDocumentFormattingEdits(document, options, token);
            }
        });
    }
}
class DocumentRangeFormattingFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentRangeFormattingRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'rangeFormatting').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.documentRangeFormattingProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector })
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDocumentRangeFormattingEdits = (document, range, options, token) => {
            let params = {
                textDocument: {
                    uri: document.uri
                },
                range,
                options,
            };
            return client
                .sendRequest(vscode_languageserver_protocol_1.DocumentRangeFormattingRequest.type, params, token)
                .then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentRangeFormattingRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDocumentRangeFormatProvider(options.documentSelector, {
            provideDocumentRangeFormattingEdits: (document, range, options, token) => {
                return middleware.provideDocumentRangeFormattingEdits
                    ? middleware.provideDocumentRangeFormattingEdits(document, range, options, token, provideDocumentRangeFormattingEdits)
                    : provideDocumentRangeFormattingEdits(document, range, options, token);
            }
        });
    }
}
class DocumentOnTypeFormattingFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentOnTypeFormattingRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'onTypeFormatting').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.documentOnTypeFormattingProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector }, capabilities.documentOnTypeFormattingProvider)
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let moreTriggerCharacter = options.moreTriggerCharacter || [];
        let provideOnTypeFormattingEdits = (document, position, ch, options, token) => {
            let params = {
                textDocument: cv.asVersionedTextDocumentIdentifier(document),
                position,
                ch,
                options
            };
            return client.sendRequest(vscode_languageserver_protocol_1.DocumentOnTypeFormattingRequest.type, params, token).then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentOnTypeFormattingRequest.type, error);
                return Promise.resolve([]);
            });
        };
        let middleware = client.clientOptions.middleware;
        let characters = [options.firstTriggerCharacter, ...moreTriggerCharacter];
        return languages_1.default.registerOnTypeFormattingEditProvider(options.documentSelector, {
            provideOnTypeFormattingEdits: (document, position, ch, options, token) => {
                return middleware.provideOnTypeFormattingEdits
                    ? middleware.provideOnTypeFormattingEdits(document, position, ch, options, token, provideOnTypeFormattingEdits)
                    : provideOnTypeFormattingEdits(document, position, ch, options, token);
            }
        }, characters);
    }
}
class RenameFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.RenameRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let rename = ensure(ensure(capabilites, 'textDocument'), 'rename');
        rename.dynamicRegistration = true;
        rename.prepareSupport = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.renameProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector }, capabilities.renameProvider || {})
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideRenameEdits = (document, position, newName, token) => {
            let params = {
                textDocument: {
                    uri: document.uri
                },
                position,
                newName: newName
            };
            return client
                .sendRequest(vscode_languageserver_protocol_1.RenameRequest.type, params, token)
                .then(res => res, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.RenameRequest.type, error);
                return Promise.reject(new Error(error.message));
            });
        };
        let prepareRename = (document, position, token) => {
            let params = {
                textDocument: cv.asTextDocumentIdentifier(document),
                position
            };
            return client.sendRequest(vscode_languageserver_protocol_1.PrepareRenameRequest.type, params, token).then(result => {
                return result;
            }, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.PrepareRenameRequest.type, error);
                return Promise.reject(new Error(error.message));
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerRenameProvider(options.documentSelector, {
            provideRenameEdits: (document, position, newName, token) => {
                return middleware.provideRenameEdits
                    ? middleware.provideRenameEdits(document, position, newName, token, provideRenameEdits)
                    : provideRenameEdits(document, position, newName, token);
            },
            prepareRename: options.prepareProvider
                ? (document, position, token) => {
                    return middleware.prepareRename
                        ? middleware.prepareRename(document, position, token, prepareRename)
                        : prepareRename(document, position, token);
                } : undefined
        });
    }
}
class DocumentLinkFeature extends TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentLinkRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'documentLink').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.documentLinkProvider || !documentSelector) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, { documentSelector: documentSelector }, capabilities.documentLinkProvider)
        });
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDocumentLinks = (document, token) => {
            return client.sendRequest(vscode_languageserver_protocol_1.DocumentLinkRequest.type, {
                textDocument: {
                    uri: document.uri
                }
            }, token).then(res => res, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentLinkRequest.type, error);
                Promise.resolve(new Error(error.message));
            });
        };
        let resolveDocumentLink = (link, token) => {
            return client
                .sendRequest(vscode_languageserver_protocol_1.DocumentLinkResolveRequest.type, link, token)
                .then(res => res, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DocumentLinkResolveRequest.type, error);
                Promise.resolve(new Error(error.message));
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDocumentLinkProvider(options.documentSelector, {
            provideDocumentLinks: (document, token) => {
                return middleware.provideDocumentLinks
                    ? middleware.provideDocumentLinks(document, token, provideDocumentLinks)
                    : provideDocumentLinks(document, token);
            },
            resolveDocumentLink: options.resolveProvider
                ? (link, token) => {
                    return middleware.resolveDocumentLink
                        ? middleware.resolveDocumentLink(link, token, resolveDocumentLink)
                        : resolveDocumentLink(link, token);
                }
                : undefined
        });
    }
}
class ConfigurationFeature {
    constructor(_client) {
        this._client = _client;
        this._listeners = new Map();
    }
    get messages() {
        return vscode_languageserver_protocol_1.DidChangeConfigurationNotification.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'workspace'), 'didChangeConfiguration').dynamicRegistration = true;
    }
    initialize() {
        let section = this._client.clientOptions.synchronize.configurationSection;
        if (section != null) {
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: {
                    section: section
                }
            });
        }
    }
    register(_message, data) {
        let { section } = data.registerOptions;
        let disposable = workspace_1.default.onDidChangeConfiguration(() => {
            if (section != null) {
                this.onDidChangeConfiguration(data.registerOptions.section);
            }
        });
        this._listeners.set(data.id, disposable);
        if (Is.string(section) && section.endsWith('.settings')) {
            let settings = this.getConfiguredSettings(section);
            if (!settings || Is.emptyObject(settings))
                return;
        }
        if (section != null) {
            this.onDidChangeConfiguration(data.registerOptions.section);
        }
    }
    unregister(id) {
        let disposable = this._listeners.get(id);
        if (disposable) {
            this._listeners.delete(id);
            disposable.dispose();
        }
    }
    dispose() {
        for (let disposable of this._listeners.values()) {
            disposable.dispose();
        }
        this._listeners.clear();
    }
    onDidChangeConfiguration(configurationSection) {
        let sections;
        if (Is.string(configurationSection)) {
            sections = [configurationSection];
        }
        else {
            sections = configurationSection;
        }
        let isConfigured = sections.length == 1 && /^languageserver\..+\.settings$/.test(sections[0]);
        let didChangeConfiguration = (sections) => {
            if (sections == null) {
                this._client.sendNotification(vscode_languageserver_protocol_1.DidChangeConfigurationNotification.type, {
                    settings: null
                });
                return;
            }
            this._client.sendNotification(vscode_languageserver_protocol_1.DidChangeConfigurationNotification.type, {
                settings: isConfigured ? this.getConfiguredSettings(sections[0]) : this.extractSettingsInformation(sections)
            });
        };
        let middleware = this.getMiddleware();
        middleware
            ? middleware(sections, didChangeConfiguration)
            : didChangeConfiguration(sections);
    }
    getConfiguredSettings(key) {
        let len = '.settings'.length;
        let config = workspace_1.default.getConfiguration(key.slice(0, -len));
        return config.get('settings', {});
    }
    extractSettingsInformation(keys) {
        function ensurePath(config, path) {
            let current = config;
            for (let i = 0; i < path.length - 1; i++) {
                let obj = current[path[i]];
                if (!obj) {
                    obj = Object.create(null);
                    current[path[i]] = obj;
                }
                current = obj;
            }
            return current;
        }
        let result = Object.create(null);
        for (let i = 0; i < keys.length; i++) {
            let key = keys[i];
            let index = key.indexOf('.');
            let config = null;
            if (index >= 0) {
                config = workspace_1.default.getConfiguration(key.substr(0, index)).get(key.substr(index + 1));
            }
            else {
                config = workspace_1.default.getConfiguration(key);
            }
            if (config) {
                let path = keys[i].split('.');
                ensurePath(result, path)[path[path.length - 1]] = config;
            }
        }
        return result;
    }
    getMiddleware() {
        let middleware = this._client.clientOptions.middleware;
        if (middleware.workspace && middleware.workspace.didChangeConfiguration) {
            return middleware.workspace.didChangeConfiguration;
        }
        else {
            return undefined;
        }
    }
}
class ExecuteCommandFeature {
    constructor(_client) {
        this._client = _client;
        this._commands = new Map();
    }
    get messages() {
        return vscode_languageserver_protocol_1.ExecuteCommandRequest.type;
    }
    fillClientCapabilities(capabilities) {
        ensure(ensure(capabilities, 'workspace'), 'executeCommand').dynamicRegistration = true;
    }
    initialize(capabilities) {
        if (!capabilities.executeCommandProvider) {
            return;
        }
        this.register(this.messages, {
            id: UUID.generateUuid(),
            registerOptions: Object.assign({}, capabilities.executeCommandProvider)
        });
    }
    register(_message, data) {
        let client = this._client;
        if (data.registerOptions.commands) {
            let disposables = [];
            for (const command of data.registerOptions.commands) {
                disposables.push(commands_1.default.registerCommand(command, (...args) => {
                    let params = {
                        command,
                        arguments: args
                    };
                    return client
                        .sendRequest(vscode_languageserver_protocol_1.ExecuteCommandRequest.type, params)
                        .then(undefined, error => {
                        client.logFailedRequest(vscode_languageserver_protocol_1.ExecuteCommandRequest.type, error);
                    });
                }, null, true));
            }
            this._commands.set(data.id, disposables);
        }
    }
    unregister(id) {
        let disposables = this._commands.get(id);
        if (disposables) {
            disposables.forEach(disposable => disposable.dispose());
        }
    }
    dispose() {
        this._commands.forEach(value => {
            value.forEach(disposable => disposable.dispose());
        });
        this._commands.clear();
    }
}
var MessageTransports;
(function (MessageTransports) {
    function is(value) {
        let candidate = value;
        return (candidate &&
            vscode_languageserver_protocol_1.MessageReader.is(value.reader) &&
            vscode_languageserver_protocol_1.MessageWriter.is(value.writer));
    }
    MessageTransports.is = is;
})(MessageTransports = exports.MessageTransports || (exports.MessageTransports = {}));
class BaseLanguageClient {
    constructor(id, name, clientOptions) {
        this._features = [];
        this._method2Message = new Map();
        this._dynamicFeatures = new Map();
        this._id = id;
        this._name = name;
        clientOptions = clientOptions || {};
        this._clientOptions = {
            disableWorkspaceFolders: clientOptions.disableWorkspaceFolders,
            disableDiagnostics: clientOptions.disableDiagnostics,
            disableCompletion: clientOptions.disableCompletion,
            ignoredRootPaths: clientOptions.ignoredRootPaths,
            documentSelector: clientOptions.documentSelector || [],
            synchronize: clientOptions.synchronize || {},
            diagnosticCollectionName: clientOptions.diagnosticCollectionName,
            outputChannelName: clientOptions.outputChannelName || this._id,
            revealOutputChannelOn: clientOptions.revealOutputChannelOn || RevealOutputChannelOn.Never,
            stdioEncoding: clientOptions.stdioEncoding || 'utf8',
            initializationOptions: clientOptions.initializationOptions,
            initializationFailedHandler: clientOptions.initializationFailedHandler,
            errorHandler: clientOptions.errorHandler || new DefaultErrorHandler(this._id),
            middleware: clientOptions.middleware || {},
            workspaceFolder: clientOptions.workspaceFolder
        };
        this._clientOptions.synchronize = this._clientOptions.synchronize || {};
        this.state = ClientState.Initial;
        this._connectionPromise = undefined;
        this._resolvedConnection = undefined;
        this._initializeResult = undefined;
        if (clientOptions.outputChannel) {
            this._outputChannel = clientOptions.outputChannel;
            this._disposeOutputChannel = false;
        }
        else {
            this._outputChannel = undefined;
            this._disposeOutputChannel = true;
        }
        this._listeners = undefined;
        this._providers = undefined;
        this._diagnostics = undefined;
        this._fileEvents = [];
        this._fileEventDelayer = new async_1.Delayer(250);
        this._onReady = new Promise((resolve, reject) => {
            this._onReadyCallbacks = new OnReady(resolve, reject);
        });
        this._onStop = undefined;
        this._stateChangeEmitter = new vscode_languageserver_protocol_1.Emitter();
        this._tracer = {
            log: (messageOrDataObject, data) => {
                if (Is.string(messageOrDataObject)) {
                    this.logTrace(messageOrDataObject, data);
                }
                else {
                    this.logObjectTrace(messageOrDataObject);
                }
            }
        };
        this._syncedDocuments = new Map();
        this.registerBuiltinFeatures();
    }
    get state() {
        return this._state;
    }
    get id() {
        return this._id;
    }
    get name() {
        return this._name;
    }
    set state(value) {
        let oldState = this.getPublicState();
        this._state = value;
        let newState = this.getPublicState();
        if (newState !== oldState) {
            this._stateChangeEmitter.fire({ oldState, newState });
        }
    }
    getPublicState() {
        if (this.state === ClientState.Running) {
            return State.Running;
        }
        else if (this.state === ClientState.Starting) {
            return State.Starting;
        }
        else {
            return State.Stopped;
        }
    }
    get initializeResult() {
        return this._initializeResult;
    }
    sendRequest(type, ...params) {
        if (!this.isConnectionActive()) {
            throw new Error('Language client is not ready yet');
        }
        this.forceDocumentSync();
        try {
            return this._resolvedConnection.sendRequest(type, ...params);
        }
        catch (error) {
            this.error(`Sending request ${Is.string(type) ? type : type.method} failed.`, error);
            throw error;
        }
    }
    onRequest(type, handler) {
        if (!this.isConnectionActive()) {
            throw new Error('Language client is not ready yet');
        }
        try {
            this._resolvedConnection.onRequest(type, handler);
        }
        catch (error) {
            this.error(`Registering request handler ${Is.string(type) ? type : type.method} failed.`, error);
            throw error;
        }
    }
    sendNotification(type, params) {
        if (!this.isConnectionActive()) {
            throw new Error('Language client is not ready yet');
        }
        this.forceDocumentSync();
        try {
            this._resolvedConnection.sendNotification(type, params);
        }
        catch (error) {
            this.error(`Sending notification ${Is.string(type) ? type : type.method} failed.`, error);
            throw error;
        }
    }
    onNotification(type, handler) {
        if (!this.isConnectionActive()) {
            throw new Error('Language client is not ready yet');
        }
        try {
            this._resolvedConnection.onNotification(type, handler);
        }
        catch (error) {
            this.error(`Registering notification handler ${Is.string(type) ? type : type.method} failed.`, error);
            throw error;
        }
    }
    get clientOptions() {
        return this._clientOptions;
    }
    get onDidChangeState() {
        return this._stateChangeEmitter.event;
    }
    get outputChannel() {
        if (!this._outputChannel) {
            let { outputChannelName } = this._clientOptions;
            this._outputChannel = workspace_1.default.createOutputChannel(outputChannelName ? outputChannelName : this._name);
        }
        return this._outputChannel;
    }
    get diagnostics() {
        return this._diagnostics;
    }
    createDefaultErrorHandler() {
        return new DefaultErrorHandler(this._id);
    }
    set trace(value) {
        this._trace = value;
        this.onReady().then(() => {
            this.resolveConnection().then(connection => {
                connection.trace(this._trace, this._tracer, {
                    sendNotification: false,
                    traceFormat: this._traceFormat
                });
            });
        }, () => { });
    }
    logObjectTrace(data) {
        if (data.isLSPMessage && data.type) {
            this.outputChannel.append(`[LSP   - ${(new Date().toLocaleTimeString())}] `);
        }
        else {
            this.outputChannel.append(`[Trace - ${(new Date().toLocaleTimeString())}] `);
        }
        if (data) {
            this.outputChannel.appendLine(`${JSON.stringify(data)}`);
        }
    }
    data2String(data) {
        if (data instanceof vscode_languageserver_protocol_1.ResponseError) {
            const responseError = data;
            return `  Message: ${responseError.message}\n  Code: ${responseError.code} ${responseError.data ? '\n' + responseError.data.toString() : ''}`;
        }
        if (data instanceof Error) {
            if (Is.string(data.stack)) {
                return data.stack;
            }
            return data.message;
        }
        if (Is.string(data)) {
            return data;
        }
        return data.toString();
    }
    _appendOutput(type, message, data) {
        let level = RevealOutputChannelOn.Error;
        switch (type) {
            case 'Info':
                level = RevealOutputChannelOn.Info;
                break;
            case 'Warn':
                level = RevealOutputChannelOn.Warn;
                break;
        }
        this.outputChannel.appendLine(`[${type}  - ${(new Date().toLocaleTimeString())}] ${message}`);
        let dataString;
        if (data) {
            dataString = this.data2String(data);
            this.outputChannel.appendLine(dataString);
        }
        if (this._clientOptions.revealOutputChannelOn <= level) {
            this.outputChannel.show(true);
        }
        if (type == 'Error' && message.indexOf('UnhandledPromiseRejectionWarning') == -1) {
            message = dataString ? message + '\n' + dataString : message;
            workspace_1.default.showMessage(`Error output from ${this.id}: ${message}`, 'error');
        }
    }
    info(message, data) {
        this._appendOutput('Info', message, data);
    }
    warn(message, data) {
        this._appendOutput('Warn', message, data);
    }
    error(message, data) {
        this._appendOutput('Error', message, data);
    }
    logTrace(message, data) {
        this.outputChannel.appendLine(`[Trace - ${(new Date().toLocaleTimeString())}] ${message}`);
        if (data) {
            this.outputChannel.appendLine(this.data2String(data));
        }
    }
    needsStart() {
        return (this.state === ClientState.Initial ||
            this.state === ClientState.Stopping ||
            this.state === ClientState.Stopped);
    }
    needsStop() {
        return (this.state === ClientState.Starting || this.state === ClientState.Running);
    }
    onReady() {
        return this._onReady;
    }
    get started() {
        return this.state != ClientState.Initial;
    }
    isConnectionActive() {
        return this.state === ClientState.Running && !!this._resolvedConnection;
    }
    start() {
        if (this._onReadyCallbacks.isUsed) {
            this._onReady = new Promise((resolve, reject) => {
                this._onReadyCallbacks = new OnReady(resolve, reject);
            });
        }
        this._listeners = [];
        this._providers = [];
        // If we restart then the diagnostics collection is reused.
        if (!this._diagnostics) {
            this._diagnostics = this._clientOptions.diagnosticCollectionName
                ? languages_1.default.createDiagnosticCollection(this._clientOptions.diagnosticCollectionName)
                : languages_1.default.createDiagnosticCollection(this._id);
        }
        this.state = ClientState.Starting;
        this.resolveConnection()
            .then(connection => {
            connection.onLogMessage(message => {
                switch (message.type) {
                    case vscode_languageserver_protocol_1.MessageType.Error:
                        this.error(message.message);
                        break;
                    case vscode_languageserver_protocol_1.MessageType.Warning:
                        this.warn(message.message);
                        break;
                    case vscode_languageserver_protocol_1.MessageType.Info:
                        this.info(message.message);
                        break;
                    default:
                        this.outputChannel.appendLine(message.message);
                }
            });
            connection.onShowMessage(message => {
                switch (message.type) {
                    case vscode_languageserver_protocol_1.MessageType.Error:
                        workspace_1.default.showMessage(message.message, 'error');
                        break;
                    case vscode_languageserver_protocol_1.MessageType.Warning:
                        workspace_1.default.showMessage(message.message, 'warning');
                        break;
                    case vscode_languageserver_protocol_1.MessageType.Info:
                        workspace_1.default.showMessage(message.message);
                        break;
                    default:
                        workspace_1.default.showMessage(message.message);
                }
            });
            connection.onRequest(vscode_languageserver_protocol_1.ShowMessageRequest.type, params => {
                if (!params.actions || params.actions.length == 0) {
                    let msgType = params.type == vscode_languageserver_protocol_1.MessageType.Error
                        ? 'error' : params.type == vscode_languageserver_protocol_1.MessageType.Warning ? 'warning' : 'more';
                    workspace_1.default.showMessage(params.message, msgType);
                    return Promise.resolve(null);
                }
                let items = params.actions.map(o => o.title);
                return workspace_1.default.showQuickpick(items, params.message).then(idx => {
                    return params.actions[idx];
                });
            });
            connection.onTelemetry(_data => {
                // ignored
            });
            connection.listen();
            // Error is handled in the intialize call.
            return this.initialize(connection);
        }).then(undefined, error => {
            this.state = ClientState.StartFailed;
            this._onReadyCallbacks.reject(error);
            this.error('Starting client failed: ', error);
        });
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            if (this.needsStop()) {
                this.stop();
            }
        });
    }
    resolveConnection() {
        if (!this._connectionPromise) {
            this._connectionPromise = this.createConnection();
        }
        return this._connectionPromise;
    }
    resolveRootPath() {
        if (this._clientOptions.workspaceFolder) {
            return vscode_uri_1.URI.parse(this._clientOptions.workspaceFolder.uri).fsPath;
        }
        let { ignoredRootPaths } = this._clientOptions;
        let config = workspace_1.default.getConfiguration(this.id);
        let rootPatterns = config.get('rootPatterns', []);
        let required = config.get('requireRootPattern', false);
        let resolved;
        if (rootPatterns && rootPatterns.length) {
            let doc = workspace_1.default.getDocument(workspace_1.default.bufnr);
            if (doc && doc.schema == 'file') {
                let dir = path_1.default.dirname(vscode_uri_1.URI.parse(doc.uri).fsPath);
                resolved = fs_1.resolveRoot(dir, rootPatterns, workspace_1.default.cwd);
            }
        }
        if (required && !resolved)
            return null;
        let rootPath = resolved || workspace_1.default.rootPath || workspace_1.default.cwd;
        if (ignoredRootPaths && ignoredRootPaths.indexOf(rootPath) !== -1) {
            workspace_1.default.showMessage(`Ignored rootPath ${rootPath} of client "${this._id}"`, 'warning');
            return null;
        }
        return rootPath;
    }
    initialize(connection) {
        this.refreshTrace(connection, false);
        let initOption = this._clientOptions.initializationOptions;
        let rootPath = this.resolveRootPath();
        if (!rootPath)
            return;
        let initParams = {
            processId: process.pid,
            rootPath: rootPath ? rootPath : null,
            rootUri: rootPath ? cv.asUri(vscode_uri_1.URI.file(rootPath)) : null,
            capabilities: this.computeClientCapabilities(),
            initializationOptions: Is.func(initOption) ? initOption() : initOption,
            trace: vscode_languageserver_protocol_1.Trace.toString(this._trace),
        };
        this.fillInitializeParams(initParams);
        return connection
            .initialize(initParams)
            .then(result => {
            this._resolvedConnection = connection;
            this._initializeResult = result;
            this.state = ClientState.Running;
            let textDocumentSyncOptions = undefined;
            if (Is.number(result.capabilities.textDocumentSync)) {
                if (result.capabilities.textDocumentSync === vscode_languageserver_protocol_1.TextDocumentSyncKind.None) {
                    textDocumentSyncOptions = {
                        openClose: false,
                        change: vscode_languageserver_protocol_1.TextDocumentSyncKind.None,
                        save: undefined
                    };
                }
                else {
                    textDocumentSyncOptions = {
                        openClose: true,
                        change: result.capabilities.textDocumentSync,
                        save: {
                            includeText: false
                        }
                    };
                }
            }
            else if (result.capabilities.textDocumentSync != null) {
                textDocumentSyncOptions = result.capabilities.textDocumentSync;
            }
            this._capabilities = Object.assign({}, result.capabilities, {
                resolvedTextDocumentSync: textDocumentSyncOptions
            });
            if (!this._clientOptions.disableDiagnostics) {
                connection.onDiagnostics(params => this.handleDiagnostics(params));
            }
            connection.onRequest(vscode_languageserver_protocol_1.RegistrationRequest.type, params => this.handleRegistrationRequest(params));
            // See https://github.com/Microsoft/vscode-languageserver-node/issues/199
            connection.onRequest('client/registerFeature', params => this.handleRegistrationRequest(params));
            connection.onRequest(vscode_languageserver_protocol_1.UnregistrationRequest.type, params => this.handleUnregistrationRequest(params));
            // See https://github.com/Microsoft/vscode-languageserver-node/issues/199
            connection.onRequest('client/unregisterFeature', params => this.handleUnregistrationRequest(params));
            connection.onRequest(vscode_languageserver_protocol_1.ApplyWorkspaceEditRequest.type, params => this.handleApplyWorkspaceEdit(params));
            connection.sendNotification(vscode_languageserver_protocol_1.InitializedNotification.type, {});
            this.hookFileEvents(connection);
            this.hookConfigurationChanged(connection);
            this.initializeFeatures(connection);
            this._onReadyCallbacks.resolve();
            return result;
        }).then(undefined, error => {
            if (this._clientOptions.initializationFailedHandler) {
                if (this._clientOptions.initializationFailedHandler(error)) {
                    this.initialize(connection);
                }
                else {
                    this.stop();
                    this._onReadyCallbacks.reject(error);
                }
            }
            else if (error instanceof vscode_languageserver_protocol_1.ResponseError &&
                error.data &&
                error.data.retry) {
                workspace_1.default.showPrompt(error.message + ' Retry?').then(confirmed => {
                    if (confirmed) {
                        this.initialize(connection);
                    }
                    else {
                        this.stop();
                        this._onReadyCallbacks.reject(error);
                    }
                });
            }
            else {
                if (error && error.message) {
                    workspace_1.default.showMessage(error.message, 'error');
                }
                this.error('Server initialization failed.', error);
                this.stop();
                this._onReadyCallbacks.reject(error);
            }
        });
    }
    stop() {
        this._initializeResult = undefined;
        if (!this._connectionPromise) {
            this.state = ClientState.Stopped;
            return Promise.resolve();
        }
        if (this.state === ClientState.Stopping && this._onStop) {
            return this._onStop;
        }
        this.state = ClientState.Stopping;
        this.cleanUp();
        // unkook listeners
        return (this._onStop = this.resolveConnection().then(connection => {
            return connection.shutdown().then(() => {
                connection.exit();
                connection.dispose();
                this.state = ClientState.Stopped;
                this._onStop = undefined;
                this._connectionPromise = undefined;
                this._resolvedConnection = undefined;
            });
        }));
    }
    cleanUp(channel = true, diagnostics = true) {
        if (this._listeners) {
            this._listeners.forEach(listener => listener.dispose());
            this._listeners = undefined;
        }
        if (this._providers) {
            this._providers.forEach(provider => provider.dispose());
            this._providers = undefined;
        }
        if (this._syncedDocuments) {
            this._syncedDocuments.clear();
        }
        for (let handler of this._dynamicFeatures.values()) {
            handler.dispose();
        }
        if (channel && this._outputChannel && this._disposeOutputChannel) {
            this._outputChannel.dispose();
            this._outputChannel = undefined;
        }
        if (diagnostics && this._diagnostics) {
            this._diagnostics.dispose();
            this._diagnostics = undefined;
        }
    }
    notifyFileEvent(event) {
        this._fileEvents.push(event);
        this._fileEventDelayer.trigger(() => {
            this.onReady().then(() => {
                this.resolveConnection().then(connection => {
                    if (this.isConnectionActive()) {
                        connection.didChangeWatchedFiles({ changes: this._fileEvents });
                    }
                    this._fileEvents = [];
                });
            }, error => {
                this.error(`Notify file events failed.`, error);
            });
        });
    }
    forceDocumentSync() {
        let doc = workspace_1.default.getDocument(workspace_1.default.bufnr);
        if (doc)
            doc.forceSync(false);
    }
    handleDiagnostics(params) {
        if (!this._diagnostics) {
            return;
        }
        let { uri, diagnostics } = params;
        let middleware = this.clientOptions.middleware.handleDiagnostics;
        if (middleware) {
            middleware(uri, diagnostics, (uri, diagnostics) => this.setDiagnostics(uri, diagnostics));
        }
        else {
            this.setDiagnostics(uri, diagnostics);
        }
    }
    setDiagnostics(uri, diagnostics) {
        if (!this._diagnostics) {
            return;
        }
        this._diagnostics.set(uri, diagnostics);
    }
    createConnection() {
        let errorHandler = (error, message, count) => {
            logger.error('connection error:', error, message);
            this.handleConnectionError(error, message, count);
        };
        let closeHandler = () => {
            this.handleConnectionClosed();
        };
        return this.createMessageTransports(this._clientOptions.stdioEncoding || 'utf8').then(transports => {
            return createConnection(transports.reader, transports.writer, errorHandler, closeHandler);
        });
    }
    handleConnectionClosed() {
        // Check whether this is a normal shutdown in progress or the client stopped normally.
        if (this.state === ClientState.Stopping ||
            this.state === ClientState.Stopped) {
            return;
        }
        try {
            if (this._resolvedConnection) {
                this._resolvedConnection.dispose();
            }
        }
        catch (error) {
            // Disposing a connection could fail if error cases.
        }
        let action = CloseAction.DoNotRestart;
        try {
            action = this._clientOptions.errorHandler.closed();
        }
        catch (error) {
            // Ignore errors coming from the error handler.
        }
        this._connectionPromise = undefined;
        this._resolvedConnection = undefined;
        if (action === CloseAction.DoNotRestart) {
            this.error('Connection to server got closed. Server will not be restarted.');
            this.state = ClientState.Stopped;
            this.cleanUp(false, true);
        }
        else if (action === CloseAction.Restart) {
            this.info('Connection to server got closed. Server will restart.');
            this.cleanUp(false, false);
            this.state = ClientState.Initial;
            this.start();
        }
    }
    restart() {
        this.cleanUp(true, false);
        this.start();
    }
    handleConnectionError(error, message, count) {
        let action = this._clientOptions.errorHandler.error(error, message, count);
        if (action === ErrorAction.Shutdown) {
            this.error('Connection to server is erroring. Shutting down server.');
            this.stop();
        }
    }
    hookConfigurationChanged(connection) {
        workspace_1.default.onDidChangeConfiguration(() => {
            this.refreshTrace(connection, true);
        });
    }
    refreshTrace(connection, sendNotification = false) {
        let config = workspace_1.default.getConfiguration(this._id);
        let trace = vscode_languageserver_protocol_1.Trace.Off;
        let traceFormat = vscode_languageserver_protocol_1.TraceFormat.Text;
        if (config) {
            const traceConfig = config.get('trace.server', 'off');
            if (typeof traceConfig === 'string') {
                trace = vscode_languageserver_protocol_1.Trace.fromString(traceConfig);
            }
            else {
                trace = vscode_languageserver_protocol_1.Trace.fromString(config.get('trace.server.verbosity', 'off'));
                traceFormat = vscode_languageserver_protocol_1.TraceFormat.fromString(config.get('trace.server.format', 'text'));
            }
        }
        this._trace = trace;
        this._traceFormat = traceFormat;
        connection.trace(this._trace, this._tracer, {
            sendNotification,
            traceFormat: this._traceFormat
        });
    }
    hookFileEvents(_connection) {
        let fileEvents = this._clientOptions.synchronize.fileEvents;
        if (!fileEvents)
            return;
        let watchers;
        if (Array.isArray(fileEvents)) {
            watchers = fileEvents;
        }
        else {
            watchers = [fileEvents];
        }
        if (!watchers) {
            return;
        }
        this._dynamicFeatures.get(vscode_languageserver_protocol_1.DidChangeWatchedFilesNotification.type.method).registerRaw(UUID.generateUuid(), watchers);
    }
    registerFeatures(features) {
        for (let feature of features) {
            this.registerFeature(feature);
        }
    }
    registerFeature(feature) {
        this._features.push(feature);
        if (DynamicFeature.is(feature)) {
            let messages = feature.messages;
            if (Array.isArray(messages)) {
                for (let message of messages) {
                    this._method2Message.set(message.method, message);
                    this._dynamicFeatures.set(message.method, feature);
                }
            }
            else {
                this._method2Message.set(messages.method, messages);
                this._dynamicFeatures.set(messages.method, feature);
            }
        }
    }
    registerBuiltinFeatures() {
        this.registerFeature(new ConfigurationFeature(this));
        this.registerFeature(new DidOpenTextDocumentFeature(this, this._syncedDocuments));
        this.registerFeature(new DidChangeTextDocumentFeature(this));
        this.registerFeature(new WillSaveFeature(this));
        this.registerFeature(new WillSaveWaitUntilFeature(this));
        this.registerFeature(new DidSaveTextDocumentFeature(this));
        this.registerFeature(new DidCloseTextDocumentFeature(this, this._syncedDocuments));
        this.registerFeature(new FileSystemWatcherFeature(this, event => this.notifyFileEvent(event)));
        if (!this._clientOptions.disableCompletion) {
            this.registerFeature(new CompletionItemFeature(this));
        }
        this.registerFeature(new HoverFeature(this));
        this.registerFeature(new SignatureHelpFeature(this));
        this.registerFeature(new DefinitionFeature(this));
        this.registerFeature(new ReferencesFeature(this));
        this.registerFeature(new DocumentHighlightFeature(this));
        this.registerFeature(new DocumentSymbolFeature(this));
        this.registerFeature(new WorkspaceSymbolFeature(this));
        this.registerFeature(new CodeActionFeature(this));
        this.registerFeature(new CodeLensFeature(this));
        this.registerFeature(new DocumentFormattingFeature(this));
        this.registerFeature(new DocumentRangeFormattingFeature(this));
        this.registerFeature(new DocumentOnTypeFormattingFeature(this));
        this.registerFeature(new RenameFeature(this));
        this.registerFeature(new DocumentLinkFeature(this));
        this.registerFeature(new ExecuteCommandFeature(this));
    }
    fillInitializeParams(params) {
        for (let feature of this._features) {
            if (Is.func(feature.fillInitializeParams)) {
                feature.fillInitializeParams(params);
            }
        }
    }
    computeClientCapabilities() {
        let result = {};
        ensure(result, 'workspace').applyEdit = true;
        let workspaceEdit = ensure(ensure(result, 'workspace'), 'workspaceEdit');
        workspaceEdit.documentChanges = true;
        workspaceEdit.resourceOperations = [vscode_languageserver_protocol_1.ResourceOperationKind.Create, vscode_languageserver_protocol_1.ResourceOperationKind.Rename, vscode_languageserver_protocol_1.ResourceOperationKind.Delete];
        workspaceEdit.failureHandling = vscode_languageserver_protocol_1.FailureHandlingKind.TextOnlyTransactional;
        ensure(ensure(result, 'textDocument'), 'publishDiagnostics').relatedInformation = true;
        for (let feature of this._features) {
            feature.fillClientCapabilities(result);
        }
        return result;
    }
    initializeFeatures(_connection) {
        let documentSelector = this._clientOptions.documentSelector;
        for (let feature of this._features) {
            feature.initialize(this._capabilities, documentSelector);
        }
    }
    handleRegistrationRequest(params) {
        return new Promise((resolve, reject) => {
            for (let registration of params.registrations) {
                const feature = this._dynamicFeatures.get(registration.method);
                if (!feature) {
                    reject(new Error(`No feature implementation for ${registration.method} found. Registration failed.`));
                    return;
                }
                const options = registration.registerOptions || {};
                options.documentSelector =
                    options.documentSelector || this._clientOptions.documentSelector;
                const data = {
                    id: registration.id,
                    registerOptions: options
                };
                feature.register(this._method2Message.get(registration.method), data);
            }
            resolve();
        });
    }
    handleUnregistrationRequest(params) {
        return new Promise((resolve, reject) => {
            for (let unregistration of params.unregisterations) {
                const feature = this._dynamicFeatures.get(unregistration.method);
                if (!feature) {
                    reject(new Error(`No feature implementation for ${unregistration.method} found. Unregistration failed.`));
                    return;
                }
                feature.unregister(unregistration.id);
            }
            resolve();
        });
    }
    handleApplyWorkspaceEdit(params) {
        return workspace_1.default.applyEdit(params.edit).then(value => {
            return { applied: value };
        });
    }
    logFailedRequest(type, error) {
        // If we get a request cancel don't log anything.
        if (error instanceof vscode_languageserver_protocol_1.ResponseError &&
            error.code === vscode_languageserver_protocol_1.ErrorCodes.RequestCancelled) {
            return;
        }
        this.error(`Request ${type.method} failed.`, error);
    }
}
exports.BaseLanguageClient = BaseLanguageClient;
//# sourceMappingURL=client.js.map