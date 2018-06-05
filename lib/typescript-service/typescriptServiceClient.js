"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path = require("path");
const fs = require("fs");
const tracer_1 = require("./utils/tracer");
const index_1 = require("../util/index");
const process_1 = require("./utils/process");
const api_1 = require("./utils/api");
const wireProtocol_1 = require("./utils/wireProtocol");
const configuration_1 = require("./utils/configuration");
const vscode_1 = require("../vscode");
const which = require("which");
const tsconfig_1 = require("./utils/tsconfig");
const versionProvider_1 = require("./utils/versionProvider");
const os = require("os");
const logger = require('../util/logger')('typescript-client');
class CallbackMap {
    constructor() {
        this.callbacks = new Map();
        this.pendingResponses = 0;
    }
    destroy(e) {
        for (const callback of this.callbacks.values()) {
            callback.e(e);
        }
        this.callbacks.clear();
        this.pendingResponses = 0;
    }
    add(seq, callback) {
        this.callbacks.set(seq, callback);
        ++this.pendingResponses;
    }
    fetch(seq) {
        const callback = this.callbacks.get(seq);
        this.delete(seq);
        return callback;
    }
    delete(seq) {
        if (this.callbacks.delete(seq)) {
            --this.pendingResponses;
        }
    }
}
class RequestQueue {
    constructor() {
        this.queue = [];
        this.sequenceNumber = 0;
    }
    get length() {
        return this.queue.length;
    }
    push(item) {
        this.queue.push(item);
    }
    shift() {
        return this.queue.shift();
    }
    tryCancelPendingRequest(seq) {
        for (let i = 0; i < this.queue.length; i++) {
            if (this.queue[i].request.seq === seq) {
                this.queue.splice(i, 1);
                return true;
            }
        }
        return false;
    }
    createRequest(command, args) {
        return {
            seq: this.sequenceNumber++,
            type: 'request',
            command,
            arguments: args
        };
    }
}
class ForkedTsServerProcess {
    constructor(childProcess) {
        this.childProcess = childProcess;
    }
    onError(cb) {
        this.childProcess.on('error', cb);
    }
    onExit(cb) {
        this.childProcess.on('exit', cb);
    }
    write(serverRequest) {
        this.childProcess.stdin.write(JSON.stringify(serverRequest) + '\r\n', 'utf8');
    }
    createReader(callback, onError) {
        // tslint:disable-next-line:no-unused-expression
        new wireProtocol_1.Reader(this.childProcess.stdout, callback, onError);
    }
    kill() {
        this.childProcess.kill();
    }
}
class TypeScriptServiceClient {
    constructor(nvim, root) {
        this.nvim = nvim;
        this.root = root;
        this.tsServerLogFile = null;
        this.isRestarting = false;
        this.cancellationPipeName = null;
        this._onTsServerStarted = new vscode_1.EventEmitter();
        this._onProjectLanguageServiceStateChanged = new vscode_1.EventEmitter();
        this._onDidBeginInstallTypings = new vscode_1.EventEmitter();
        this._onDidEndInstallTypings = new vscode_1.EventEmitter();
        this._onTypesInstallerInitializationFailed = new vscode_1.EventEmitter();
        this.disposables = [];
        this._onDiagnosticsReceived = new vscode_1.EventEmitter();
        this._onConfigDiagnosticsReceived = new vscode_1.EventEmitter();
        this._onResendModelsRequested = new vscode_1.EventEmitter();
        this.root = root;
        this.pathSeparator = path.sep;
        this.lastStart = Date.now();
        let p = new Promise((resolve, reject) => {
            // tslint:disable-line
            this._onReady = { promise: p, resolve, reject };
        });
        this._onReady.promise = p;
        this.servicePromise = null;
        this.lastError = null;
        this.numberRestarts = 0;
        this.requestQueue = new RequestQueue();
        this.callbacks = new CallbackMap();
        this._configuration = configuration_1.TypeScriptServiceConfiguration.loadFromWorkspace();
        this.versionProvider = new versionProvider_1.TypeScriptVersionProvider(this._configuration);
        this._apiVersion = api_1.default.defaultVersion;
        this._tsserverVersion = undefined;
        this.tracer = new tracer_1.default(logger);
    }
    get onDiagnosticsReceived() {
        return this._onDiagnosticsReceived.event;
    }
    get onConfigDiagnosticsReceived() {
        return this._onConfigDiagnosticsReceived.event;
    }
    get onResendModelsRequested() {
        return this._onResendModelsRequested.event;
    }
    get configuration() {
        return this._configuration;
    }
    dispose() {
        this._onTsServerStarted.dispose();
        this._onDidBeginInstallTypings.dispose();
        this._onDidEndInstallTypings.dispose();
        this._onTypesInstallerInitializationFailed.dispose();
        if (this.servicePromise) {
            this.servicePromise
                .then(childProcess => {
                childProcess.kill();
            })
                .then(undefined, () => void 0);
        }
        vscode_1.disposeAll(this.disposables);
        this._onDiagnosticsReceived.dispose();
        this._onConfigDiagnosticsReceived.dispose();
        this._onResendModelsRequested.dispose();
    }
    restartTsServer() {
        const start = () => {
            this.servicePromise = this.startService(true);
            return this.servicePromise;
        };
        if (this.servicePromise) {
            this.servicePromise.then(childProcess => {
                this.info('Killing TS Server');
                this.isRestarting = true;
                childProcess.kill();
                this.resetClientVersion();
                this.servicePromise = null;
            }).then(start);
        }
        else {
            start();
        }
    }
    get onTsServerStarted() {
        return this._onTsServerStarted.event;
    }
    get onProjectLanguageServiceStateChanged() {
        return this._onProjectLanguageServiceStateChanged.event;
    }
    get onDidBeginInstallTypings() {
        return this._onDidBeginInstallTypings.event;
    }
    get onDidEndInstallTypings() {
        return this._onDidEndInstallTypings.event;
    }
    get onTypesInstallerInitializationFailed() {
        return this._onTypesInstallerInitializationFailed.event;
    }
    get apiVersion() {
        return this._apiVersion;
    }
    onReady(f) {
        return this._onReady.promise.then(f);
    }
    info(message, data) {
        logger.info(message, data);
    }
    error(message, data) {
        logger.error(message, data);
    }
    service() {
        if (this.servicePromise) {
            return this.servicePromise;
        }
        if (this.lastError) {
            return Promise.reject(this.lastError);
        }
        this.startService(); // tslint:disable-line
        if (this.servicePromise) {
            return this.servicePromise;
        }
        return Promise.reject(new Error('Could not create TS service'));
    }
    ensureServiceStarted() {
        if (!this.servicePromise) {
            this.startService(); // tslint:disable-line
        }
    }
    startService(resendModels = false) {
        let { root } = this;
        let currentVersion = this.versionProvider.getLocalVersion(root);
        if (!currentVersion && !fs.existsSync(currentVersion.tsServerPath)) {
            index_1.echoWarning(this.nvim, `Can't find local tsserver, Falling back to global TypeScript version.`); // tslint:disable-line
            currentVersion = this.versionProvider.defaultVersion;
        }
        if (!currentVersion.isValid) {
            index_1.echoErr(this.nvim, 'Can not find tsserver'); // tslint:disable-line
            return;
        }
        this.info(`Using tsserver from: ${currentVersion.path}`);
        this._apiVersion = currentVersion.version;
        this.requestQueue = new RequestQueue();
        this.callbacks = new CallbackMap();
        this.lastError = null;
        return (this.servicePromise = new Promise((resolve, reject) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            try {
                const tsServerForkArgs = yield this.getTsServerArgs(currentVersion);
                const debugPort = this.getDebugPort();
                const tsServerForkOptions = {
                    execArgv: debugPort ? [`--inspect=${debugPort}`] : [],
                    cwd: this.root
                };
                process_1.fork(currentVersion.tsServerPath, tsServerForkArgs, tsServerForkOptions, (err, childProcess) => {
                    if (err || !childProcess) {
                        this.lastError = err;
                        this.error('Starting TSServer failed with error.', err);
                        /* __GDPR__
                                    "error" : {}
                                */
                        this.resetClientVersion();
                        return;
                    }
                    this.info('Started TSServer');
                    const handle = new ForkedTsServerProcess(childProcess);
                    this.lastStart = Date.now();
                    handle.onError((err) => {
                        this.lastError = err;
                        this.error('TSServer errored with error.', err);
                        if (this.tsServerLogFile) {
                            this.error(`TSServer log file: ${this.tsServerLogFile}`);
                        }
                        this.serviceExited(false);
                    });
                    handle.onExit((code) => {
                        if (code === null || typeof code === 'undefined') {
                            this.info('TSServer exited');
                        }
                        else {
                            this.error(`TSServer exited with code: ${code}`);
                        }
                        if (this.tsServerLogFile) {
                            this.info(`TSServer log file: ${this.tsServerLogFile}`);
                        }
                        this.serviceExited(!this.isRestarting);
                        this.isRestarting = false;
                    });
                    handle.createReader(msg => {
                        this.dispatchMessage(msg);
                    }, error => {
                        this.error('ReaderError', error);
                    });
                    this._onReady.resolve();
                    resolve(handle);
                    this._onTsServerStarted.fire(currentVersion.version);
                    this.serviceStarted(resendModels);
                });
            }
            catch (error) {
                reject(error);
            }
        })));
    }
    openTsServerLogFile() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.apiVersion.has222Features()) {
                index_1.echoErr(this.nvim, 'TS Server logging requires TS 2.2.2+'); // tslint:disable-line
                return false;
            }
            if (this._configuration.tsServerLogLevel === configuration_1.TsServerLogLevel.Off) {
                index_1.echoErr(this.nvim, 'TS Server logging is off. Set env TSS_LOG_LEVEL to enable logging'); // tslint:disable-line
                return false;
            }
            if (!this.tsServerLogFile) {
                index_1.echoErr(this.nvim, 'TS Server has not started logging.'); // tslint:disable-line
                return false;
            }
            try {
                yield this.nvim.command(`edit ${this.tsServerLogFile}`);
                return true;
            }
            catch (_a) {
                index_1.echoErr(this.nvim, 'Could not open TS Server log file'); // tslint:disable-line
                return false;
            }
        });
    }
    serviceStarted(resendModels) {
        const configureOptions = {
            hostInfo: 'coc-nvim'
        };
        this.execute('configure', configureOptions).catch(err => {
            logger.error(err);
        });
        this.setCompilerOptionsForInferredProjects(this._configuration);
        if (resendModels) {
            this._onResendModelsRequested.fire();
        }
    }
    setCompilerOptionsForInferredProjects(configuration) {
        if (!this.apiVersion.has206Features()) {
            return;
        }
        const args = {
            options: this.getCompilerOptionsForInferredProjects(configuration)
        };
        this.execute('compilerOptionsForInferredProjects', args, true); // tslint:disable-line
    }
    getCompilerOptionsForInferredProjects(configuration) {
        return Object.assign({}, tsconfig_1.inferredProjectConfig(configuration), { allowJs: true, allowSyntheticDefaultImports: true, allowNonTsExtensions: true });
    }
    serviceExited(restart) {
        this.servicePromise = null;
        this.tsServerLogFile = null;
        this.callbacks.destroy(new Error('Service died.'));
        this.callbacks = new CallbackMap();
        if (!restart) {
            this.resetClientVersion();
        }
        else {
            const diff = Date.now() - this.lastStart;
            this.numberRestarts++;
            let startService = true;
            if (this.numberRestarts > 5) {
                this.numberRestarts = 0;
                if (diff < 10 * 1000 /* 10 seconds */) {
                    this.lastStart = Date.now();
                    startService = false;
                    index_1.echoErr(this.nvim, 'The TypeScript language service died 5 times right after it got started.'); // tslint:disable-line
                    this.resetClientVersion();
                }
                else if (diff < 60 * 1000 /* 1 Minutes */) {
                    this.lastStart = Date.now();
                    index_1.echoErr(this.nvim, 'The TypeScript language service died unexpectedly 5 times in the last 5 Minutes.'); // tslint:disable-line
                }
            }
            if (startService) {
                this.startService(true); // tslint:disable-line
            }
        }
    }
    normalizePath(resource) {
        if (this._apiVersion.has213Features()) {
            if (resource.scheme === vscode_1.fileSchemes.walkThroughSnippet ||
                resource.scheme === vscode_1.fileSchemes.untitled) {
                const dirName = path.dirname(resource.path);
                const fileName = this.inMemoryResourcePrefix + path.basename(resource.path);
                return resource
                    .with({ path: path.posix.join(dirName, fileName) })
                    .toString(true);
            }
        }
        if (resource.scheme !== vscode_1.fileSchemes.file) {
            return null;
        }
        const result = resource.fsPath;
        if (!result) {
            return null;
        }
        // Both \ and / must be escaped in regular expressions
        return result.replace(new RegExp('\\' + this.pathSeparator, 'g'), '/');
    }
    get inMemoryResourcePrefix() {
        return this._apiVersion.has270Features() ? '^' : '';
    }
    asUrl(filepath) {
        if (this._apiVersion.has213Features()) {
            if (filepath.startsWith(TypeScriptServiceClient.WALK_THROUGH_SNIPPET_SCHEME_COLON) ||
                filepath.startsWith(vscode_1.fileSchemes.untitled + ':')) {
                let resource = vscode_1.Uri.parse(filepath);
                if (this.inMemoryResourcePrefix) {
                    const dirName = path.dirname(resource.path);
                    const fileName = path.basename(resource.path);
                    if (fileName.startsWith(this.inMemoryResourcePrefix)) {
                        resource = resource.with({
                            path: path.posix.join(dirName, fileName.slice(this.inMemoryResourcePrefix.length))
                        });
                    }
                }
                return resource;
            }
        }
        return vscode_1.Uri.file(filepath);
    }
    execute(command, args, expectsResultOrToken) {
        let token;
        let expectsResult = true;
        if (typeof expectsResultOrToken === 'boolean') {
            expectsResult = expectsResultOrToken;
        }
        else {
            token = expectsResultOrToken;
        }
        const request = this.requestQueue.createRequest(command, args);
        const requestInfo = {
            request,
            callbacks: null
        };
        let result;
        if (expectsResult) {
            let wasCancelled = false;
            result = new Promise((resolve, reject) => {
                requestInfo.callbacks = { c: resolve, e: reject, start: Date.now() };
                if (token) {
                    token.onCancellationRequested(() => {
                        wasCancelled = true;
                        this.tryCancelRequest(request.seq);
                    });
                }
            }).catch((err) => {
                if (!wasCancelled) {
                    this.error(`'${command}' request failed with error.`, err);
                }
                throw err;
            });
        }
        else {
            result = Promise.resolve(null);
        }
        this.requestQueue.push(requestInfo);
        this.sendNextRequests();
        return result;
    }
    sendNextRequests() {
        while (this.callbacks.pendingResponses === 0 &&
            this.requestQueue.length > 0) {
            const item = this.requestQueue.shift();
            if (item) {
                this.sendRequest(item);
            }
        }
    }
    sendRequest(requestItem) {
        const serverRequest = requestItem.request;
        this.tracer.traceRequest(serverRequest, !!requestItem.callbacks, this.requestQueue.length);
        if (requestItem.callbacks) {
            this.callbacks.add(serverRequest.seq, requestItem.callbacks);
        }
        this.service()
            .then(childProcess => {
            childProcess.write(serverRequest);
        })
            .then(undefined, err => {
            const callback = this.callbacks.fetch(serverRequest.seq);
            if (callback) {
                callback.e(err);
            }
        });
    }
    tryCancelRequest(seq) {
        try {
            if (this.requestQueue.tryCancelPendingRequest(seq)) {
                this.tracer.logTrace(`TypeScript Service: canceled request with sequence number ${seq}`);
                return true;
            }
            if (this.apiVersion.has222Features() && this.cancellationPipeName) {
                this.tracer.logTrace(`TypeScript Service: trying to cancel ongoing request with sequence number ${seq}`);
                try {
                    fs.writeFileSync(this.cancellationPipeName + seq, '');
                }
                catch (_a) {
                    // noop
                }
                return true;
            }
            this.tracer.logTrace(`TypeScript Service: tried to cancel request with sequence number ${seq}. But request got already delivered.`);
            return false;
        }
        finally {
            const p = this.callbacks.fetch(seq);
            if (p) {
                p.e(new Error(`Cancelled Request ${seq}`));
            }
        }
    }
    dispatchMessage(message) {
        try {
            if (message.type === 'response') {
                const response = message;
                const p = this.callbacks.fetch(response.request_seq);
                if (p) {
                    this.tracer.traceResponse(response, p.start);
                    if (response.success) {
                        p.c(response);
                    }
                    else {
                        p.e(response);
                    }
                }
            }
            else if (message.type === 'event') {
                const event = message;
                this.tracer.traceEvent(event);
                this.dispatchEvent(event);
            }
            else {
                throw new Error('Unknown message type ' + message.type + ' received');
            }
        }
        finally {
            this.sendNextRequests();
        }
    }
    dispatchEvent(event) {
        switch (event.event) {
            case 'syntaxDiag':
            case 'semanticDiag':
            case 'suggestionDiag':
                const diagnosticEvent = event;
                if (diagnosticEvent.body && diagnosticEvent.body.diagnostics) {
                    this._onDiagnosticsReceived.fire({
                        kind: getDignosticsKind(event),
                        resource: this.asUrl(diagnosticEvent.body.file),
                        diagnostics: diagnosticEvent.body.diagnostics
                    });
                }
                break;
            case 'configFileDiag':
                this._onConfigDiagnosticsReceived.fire(event);
                break;
            case 'projectLanguageServiceState':
                if (event.body) {
                    this._onProjectLanguageServiceStateChanged.fire(event.body);
                }
                break;
            case 'beginInstallTypes':
                if (event.body) {
                    this._onDidBeginInstallTypings.fire(event.body);
                }
                break;
            case 'endInstallTypes':
                if (event.body) {
                    this._onDidEndInstallTypings.fire(event.body);
                }
                break;
            case 'typesInstallerInitializationFailed':
                if (event.body) {
                    this._onTypesInstallerInitializationFailed.fire(event.body);
                }
                break;
        }
    }
    getTsServerArgs(currentVersion) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            const args = [];
            if (this.apiVersion.has206Features()) {
                if (this.apiVersion.has250Features()) {
                    args.push('--useInferredProjectPerProjectRoot');
                }
                else {
                    args.push('--useSingleInferredProject');
                }
                if (this._configuration.disableAutomaticTypeAcquisition) {
                    args.push('--disableAutomaticTypingAcquisition');
                }
            }
            if (this.apiVersion.has208Features()) {
                args.push('--enableTelemetry');
            }
            if (this.apiVersion.has222Features()) {
                this.cancellationPipeName = process_1.getTempFile(`tscancellation-${process_1.makeRandomHexString(20)}`);
                args.push('--cancellationPipeName', this.cancellationPipeName + '*');
            }
            if (this.apiVersion.has222Features()) {
                if (this._configuration.tsServerLogLevel !== configuration_1.TsServerLogLevel.Off) {
                    const logDir = os.tmpdir();
                    if (logDir) {
                        this.tsServerLogFile = path.join(logDir, `coc-tsserver.log`);
                        this.info(`TSServer log file: ${this.tsServerLogFile}`);
                    }
                    else {
                        this.tsServerLogFile = null;
                        this.error('Could not create TSServer log directory');
                    }
                    if (this.tsServerLogFile) {
                        args.push('--logVerbosity', configuration_1.TsServerLogLevel.toString(this._configuration.tsServerLogLevel));
                        args.push('--logFile', this.tsServerLogFile);
                    }
                }
            }
            if (this.apiVersion.has230Features()) {
                const plugins = this._configuration.tsServerPluginNames;
                const pluginRoot = this._configuration.tsServerPluginRoot;
                if (plugins.length) {
                    args.push('--globalPlugins', plugins.join(','));
                    if (pluginRoot) {
                        args.push('--pluginProbeLocations', pluginRoot);
                    }
                }
            }
            if (this.apiVersion.has234Features()) {
                if (this._configuration.npmLocation) {
                    args.push('--npmLocation', `"${this._configuration.npmLocation}"`);
                }
                else {
                    try {
                        args.push('--npmLocation', `${which.sync('npm')}`);
                    }
                    catch (e) { } // tslint:disable-line
                }
            }
            return args;
        });
    }
    getDebugPort() {
        const value = process.env['TSS_DEBUG']; // tslint:disable-line
        if (value) {
            const port = parseInt(value, 10);
            if (!isNaN(port)) {
                return port;
            }
        }
        return undefined;
    }
    resetClientVersion() {
        this._apiVersion = api_1.default.defaultVersion;
        this._tsserverVersion = undefined;
    }
}
TypeScriptServiceClient.WALK_THROUGH_SNIPPET_SCHEME_COLON = `${vscode_1.fileSchemes.walkThroughSnippet}:`;
exports.default = TypeScriptServiceClient;
function getDignosticsKind(event) {
    switch (event.event) {
        case 'syntaxDiag':
            return vscode_1.DiagnosticKind.Syntax;
        case 'semanticDiag':
            return vscode_1.DiagnosticKind.Semantic;
        case 'suggestionDiag':
            return vscode_1.DiagnosticKind.Suggestion;
    }
    throw new Error('Unknown dignostics kind');
}
//# sourceMappingURL=typescriptServiceClient.js.map