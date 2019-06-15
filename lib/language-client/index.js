"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
const child_process_1 = tslib_1.__importDefault(require("child_process"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const types_1 = require("../types");
const util_1 = require("../util");
const Is = tslib_1.__importStar(require("../util/is"));
const processes_1 = require("../util/processes");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const which_1 = tslib_1.__importDefault(require("which"));
const client_1 = require("./client");
const colorProvider_1 = require("./colorProvider");
const configuration_1 = require("./configuration");
const declaration_1 = require("./declaration");
const foldingRange_1 = require("./foldingRange");
const implementation_1 = require("./implementation");
const typeDefinition_1 = require("./typeDefinition");
const workspaceFolders_1 = require("./workspaceFolders");
const string_1 = require("../util/string");
const logger = require('../util/logger')('language-client-index');
tslib_1.__exportStar(require("./client"), exports);
var Executable;
(function (Executable) {
    function is(value) {
        return Is.string(value.command);
    }
    Executable.is = is;
})(Executable || (Executable = {}));
var TransportKind;
(function (TransportKind) {
    TransportKind[TransportKind["stdio"] = 0] = "stdio";
    TransportKind[TransportKind["ipc"] = 1] = "ipc";
    TransportKind[TransportKind["pipe"] = 2] = "pipe";
    TransportKind[TransportKind["socket"] = 3] = "socket";
})(TransportKind = exports.TransportKind || (exports.TransportKind = {}));
var Transport;
(function (Transport) {
    function isSocket(value) {
        let candidate = value;
        return (candidate &&
            candidate.kind === TransportKind.socket &&
            Is.number(candidate.port));
    }
    Transport.isSocket = isSocket;
})(Transport || (Transport = {}));
var NodeModule;
(function (NodeModule) {
    function is(value) {
        return Is.string(value.module);
    }
    NodeModule.is = is;
})(NodeModule || (NodeModule = {}));
var StreamInfo;
(function (StreamInfo) {
    function is(value) {
        let candidate = value;
        return (candidate && candidate.writer !== void 0 && candidate.reader !== void 0);
    }
    StreamInfo.is = is;
})(StreamInfo || (StreamInfo = {}));
var ChildProcessInfo;
(function (ChildProcessInfo) {
    function is(value) {
        let candidate = value;
        return (candidate &&
            candidate.process !== void 0 &&
            typeof candidate.detached === 'boolean');
    }
    ChildProcessInfo.is = is;
})(ChildProcessInfo || (ChildProcessInfo = {}));
class LanguageClient extends client_1.BaseLanguageClient {
    constructor(arg1, arg2, arg3, arg4, arg5) {
        let id;
        let name;
        let serverOptions;
        let clientOptions;
        let forceDebug;
        if (Is.string(arg2)) {
            id = arg1;
            name = arg2;
            serverOptions = arg3;
            clientOptions = arg4;
            forceDebug = !!arg5;
        }
        else {
            id = arg1.toLowerCase();
            name = arg1;
            serverOptions = arg2;
            clientOptions = arg3;
            forceDebug = arg4;
        }
        if (forceDebug === void 0) {
            forceDebug = false;
        }
        super(id, name, clientOptions);
        this._serverOptions = serverOptions;
        this._forceDebug = forceDebug;
        this.registerProposedFeatures();
    }
    stop() {
        return super.stop().then(() => {
            if (this._serverProcess) {
                let toCheck = this._serverProcess;
                this._serverProcess = undefined;
                if (this._isDetached === void 0 || !this._isDetached) {
                    this.checkProcessDied(toCheck);
                }
                this._isDetached = undefined;
            }
        });
    }
    get serviceState() {
        let state = this._state;
        switch (state) {
            case client_1.ClientState.Initial:
                return types_1.ServiceStat.Initial;
            case client_1.ClientState.Running:
                return types_1.ServiceStat.Running;
            case client_1.ClientState.StartFailed:
                return types_1.ServiceStat.StartFailed;
            case client_1.ClientState.Starting:
                return types_1.ServiceStat.Starting;
            case client_1.ClientState.Stopped:
                return types_1.ServiceStat.Stopped;
            case client_1.ClientState.Stopping:
                return types_1.ServiceStat.Stopping;
            default:
                logger.error(`Unknown state: ${state}`);
                return types_1.ServiceStat.Stopped;
        }
    }
    static stateName(state) {
        switch (state) {
            case client_1.ClientState.Initial:
                return 'Initial';
            case client_1.ClientState.Running:
                return 'Running';
            case client_1.ClientState.StartFailed:
                return 'StartFailed';
            case client_1.ClientState.Starting:
                return 'Starting';
            case client_1.ClientState.Stopped:
                return 'Stopped';
            case client_1.ClientState.Stopping:
                return 'Stopping';
            default:
                return 'Unknonw';
        }
    }
    checkProcessDied(childProcess) {
        if (!childProcess || global.hasOwnProperty('__TEST__'))
            return;
        setTimeout(() => {
            // Test if the process is still alive. Throws an exception if not
            try {
                process.kill(childProcess.pid, 0);
                processes_1.terminate(childProcess);
            }
            catch (error) {
                // All is fine.
            }
        }, 1000);
    }
    handleConnectionClosed() {
        this._serverProcess = undefined;
        super.handleConnectionClosed();
    }
    async createMessageTransports(encoding) {
        function getEnvironment(env) {
            if (!env)
                return process.env;
            return Object.assign({}, process.env, env);
        }
        function startedInDebugMode() {
            let args = process.execArgv;
            if (args) {
                return args.some(arg => /^--debug=?/.test(arg) ||
                    /^--debug-brk=?/.test(arg) ||
                    /^--inspect=?/.test(arg) ||
                    /^--inspect-brk=?/.test(arg));
            }
            return false;
        }
        let server = this._serverOptions;
        // We got a function.
        if (Is.func(server)) {
            let result = await Promise.resolve(server());
            if (client_1.MessageTransports.is(result)) {
                this._isDetached = !!result.detached;
                return result;
            }
            else if (StreamInfo.is(result)) {
                this._isDetached = !!result.detached;
                return {
                    reader: new vscode_languageserver_protocol_1.StreamMessageReader(result.reader),
                    writer: new vscode_languageserver_protocol_1.StreamMessageWriter(result.writer)
                };
            }
            else {
                let cp;
                if (ChildProcessInfo.is(result)) {
                    cp = result.process;
                    this._isDetached = result.detached;
                }
                else {
                    cp = result;
                    this._isDetached = false;
                }
                cp.stderr.on('data', data => this.appendOutput(data, encoding));
                return {
                    reader: new vscode_languageserver_protocol_1.StreamMessageReader(cp.stdout),
                    writer: new vscode_languageserver_protocol_1.StreamMessageWriter(cp.stdin)
                };
            }
        }
        let json = server;
        let runDebug = server;
        if (runDebug.run || runDebug.debug) {
            // We are under debugging. So use debug as well.
            if (typeof v8debug === 'object' || this._forceDebug || startedInDebugMode()) {
                json = runDebug.debug;
            }
            else {
                json = runDebug.run;
            }
        }
        else {
            json = server;
        }
        let serverWorkingDir = await this._getServerWorkingDir(json.options);
        if (NodeModule.is(json) && json.module) {
            let node = json;
            let transport = node.transport || TransportKind.stdio;
            let args = [];
            let options = node.options || Object.create(null);
            let runtime = node.runtime || process.execPath;
            if (options.execArgv)
                options.execArgv.forEach(element => args.push(element));
            if (transport != TransportKind.ipc)
                args.push(node.module);
            if (node.args)
                node.args.forEach(element => args.push(element));
            let execOptions = Object.create(null);
            execOptions.cwd = serverWorkingDir;
            execOptions.env = getEnvironment(options.env);
            let pipeName;
            if (transport === TransportKind.ipc) {
                execOptions.stdio = [null, null, null];
                args.push('--node-ipc');
            }
            else if (transport === TransportKind.stdio) {
                args.push('--stdio');
            }
            else if (transport === TransportKind.pipe) {
                pipeName = vscode_languageserver_protocol_1.generateRandomPipeName();
                args.push(`--pipe=${pipeName}`);
            }
            else if (Transport.isSocket(transport)) {
                args.push(`--socket=${transport.port}`);
            }
            args.push(`--clientProcessId=${process.pid.toString()}`);
            if (transport === TransportKind.ipc) {
                let forkOptions = {
                    cwd: serverWorkingDir,
                    env: getEnvironment(options.env),
                    stdio: [null, null, null, 'ipc'],
                    execPath: runtime,
                    execArgv: options.execArgv || [],
                };
                let serverProcess = child_process_1.default.fork(node.module, args, forkOptions);
                if (!serverProcess || !serverProcess.pid) {
                    throw new Error(`Launching server ${node.module} failed.`);
                }
                this._serverProcess = serverProcess;
                serverProcess.stdout.on('data', data => this.appendOutput(data, encoding));
                serverProcess.stderr.on('data', data => this.appendOutput(data, encoding));
                return {
                    reader: new vscode_languageserver_protocol_1.IPCMessageReader(serverProcess),
                    writer: new vscode_languageserver_protocol_1.IPCMessageWriter(serverProcess)
                };
            }
            else if (transport === TransportKind.stdio) {
                let serverProcess = child_process_1.default.spawn(runtime, args, execOptions);
                if (!serverProcess || !serverProcess.pid) {
                    throw new Error(`Launching server ${node.module} failed.`);
                }
                this._serverProcess = serverProcess;
                serverProcess.stderr.on('data', data => this.appendOutput(data, encoding));
                return {
                    reader: new vscode_languageserver_protocol_1.StreamMessageReader(serverProcess.stdout),
                    writer: new vscode_languageserver_protocol_1.StreamMessageWriter(serverProcess.stdin)
                };
            }
            else if (transport == TransportKind.pipe) {
                let transport = await Promise.resolve(vscode_languageserver_protocol_1.createClientPipeTransport(pipeName));
                let process = child_process_1.default.spawn(runtime, args, execOptions);
                if (!process || !process.pid) {
                    throw new Error(`Launching server ${node.module} failed.`);
                }
                this._serverProcess = process;
                process.stderr.on('data', data => this.appendOutput(data, encoding));
                process.stdout.on('data', data => this.appendOutput(data, encoding));
                let protocol = await Promise.resolve(transport.onConnected());
                return { reader: protocol[0], writer: protocol[1] };
            }
            else if (Transport.isSocket(node.transport)) {
                let transport = await Promise.resolve(vscode_languageserver_protocol_1.createClientSocketTransport(node.transport.port));
                let process = child_process_1.default.spawn(runtime, args, execOptions);
                if (!process || !process.pid) {
                    throw new Error(`Launching server ${node.module} failed.`);
                }
                this._serverProcess = process;
                process.stderr.on('data', data => this.appendOutput(data, encoding));
                process.stdout.on('data', data => this.appendOutput(data, encoding));
                let protocol = await Promise.resolve(transport.onConnected());
                return { reader: protocol[0], writer: protocol[1] };
            }
        }
        else if (Executable.is(json) && json.command) {
            let command = json;
            let args = command.args || [];
            let options = Object.assign({}, command.options);
            options.env = options.env ? Object.assign(options.env, process.env) : process.env;
            options.cwd = options.cwd || serverWorkingDir;
            let cmd = json.command;
            if (cmd.startsWith('~')) {
                cmd = os_1.default.homedir() + cmd.slice(1);
            }
            if (cmd.indexOf('$') !== -1) {
                cmd = string_1.resolveVariables(cmd, { workspaceFolder: workspace_1.default.rootPath });
            }
            try {
                which_1.default.sync(cmd);
            }
            catch (e) {
                throw new Error(`Command "${cmd}" of ${this.id} is not executable: ${e}`);
            }
            let serverProcess = child_process_1.default.spawn(cmd, args, options);
            if (!serverProcess || !serverProcess.pid) {
                throw new Error(`Launching server using command ${command.command} failed.`);
            }
            serverProcess.on('exit', code => {
                if (code != 0)
                    this.error(`${command.command} exited with code: ${code}`);
            });
            serverProcess.stderr.on('data', data => this.appendOutput(data, encoding));
            this._serverProcess = serverProcess;
            this._isDetached = !!options.detached;
            return {
                reader: new vscode_languageserver_protocol_1.StreamMessageReader(serverProcess.stdout),
                writer: new vscode_languageserver_protocol_1.StreamMessageWriter(serverProcess.stdin)
            };
        }
        throw new Error(`Unsupported server configuration ` + JSON.stringify(server, null, 4));
    }
    registerProposedFeatures() {
        this.registerFeatures(ProposedFeatures.createAll(this));
    }
    registerBuiltinFeatures() {
        super.registerBuiltinFeatures();
        this.registerFeature(new configuration_1.ConfigurationFeature(this));
        this.registerFeature(new typeDefinition_1.TypeDefinitionFeature(this));
        this.registerFeature(new implementation_1.ImplementationFeature(this));
        this.registerFeature(new declaration_1.DeclarationFeature(this));
        this.registerFeature(new colorProvider_1.ColorProviderFeature(this));
        this.registerFeature(new foldingRange_1.FoldingRangeFeature(this));
        if (!this.clientOptions.disableWorkspaceFolders) {
            this.registerFeature(new workspaceFolders_1.WorkspaceFoldersFeature(this));
        }
    }
    _getServerWorkingDir(options) {
        let cwd = options && options.cwd;
        if (cwd && !path_1.default.isAbsolute(cwd))
            cwd = path_1.default.join(workspace_1.default.cwd, cwd);
        if (!cwd)
            cwd = workspace_1.default.cwd;
        if (cwd) {
            // make sure the folder exists otherwise creating the process will fail
            return new Promise(s => {
                fs_1.default.lstat(cwd, (err, stats) => {
                    s(!err && stats.isDirectory() ? cwd : undefined);
                });
            });
        }
        return Promise.resolve(undefined);
    }
    appendOutput(data, encoding) {
        let msg = Is.string(data) ? data : data.toString(encoding);
        if (global.hasOwnProperty('__TEST__')) {
            console.log(msg); // tslint:disable-line
            return;
        }
        if (process.env.NVIM_COC_LOG_LEVEL == 'debug') {
            logger.debug(`[${this.id}]`, msg);
        }
        this.outputChannel.append(msg.endsWith('\n') ? msg : msg + '\n');
    }
}
exports.LanguageClient = LanguageClient;
class SettingMonitor {
    constructor(_client, _setting) {
        this._client = _client;
        this._setting = _setting;
        this._listeners = [];
    }
    start() {
        workspace_1.default.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(this._setting)) {
                this.onDidChangeConfiguration();
            }
        }, null, this._listeners);
        this.onDidChangeConfiguration();
        return {
            dispose: () => {
                util_1.disposeAll(this._listeners);
                if (this._client.needsStop()) {
                    this._client.stop();
                }
            }
        };
    }
    onDidChangeConfiguration() {
        let index = this._setting.indexOf('.');
        let primary = index >= 0 ? this._setting.substr(0, index) : this._setting;
        let rest = index >= 0 ? this._setting.substr(index + 1) : undefined;
        let enabled = rest
            ? workspace_1.default.getConfiguration(primary).get(rest, true)
            : workspace_1.default.getConfiguration(primary);
        if (enabled && this._client.needsStart()) {
            this._client.start();
        }
        else if (!enabled && this._client.needsStop()) {
            this._client.stop();
        }
    }
}
exports.SettingMonitor = SettingMonitor;
// Exporting proposed protocol.
var ProposedFeatures;
(function (ProposedFeatures) {
    function createAll(_client) {
        let result = [];
        return result;
    }
    ProposedFeatures.createAll = createAll;
})(ProposedFeatures = exports.ProposedFeatures || (exports.ProposedFeatures = {}));
//# sourceMappingURL=index.js.map