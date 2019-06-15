"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = require("events");
const https_1 = tslib_1.__importDefault(require("https"));
const semver_1 = tslib_1.__importDefault(require("semver"));
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const commands_1 = tslib_1.__importDefault(require("./commands"));
const completion_1 = tslib_1.__importDefault(require("./completion"));
const manager_1 = tslib_1.__importDefault(require("./diagnostic/manager"));
const extensions_1 = tslib_1.__importDefault(require("./extensions"));
const handler_1 = tslib_1.__importDefault(require("./handler"));
const manager_2 = tslib_1.__importDefault(require("./list/manager"));
const services_1 = tslib_1.__importDefault(require("./services"));
const manager_3 = tslib_1.__importDefault(require("./snippets/manager"));
const sources_1 = tslib_1.__importDefault(require("./sources"));
const types_1 = require("./types");
const clean_1 = tslib_1.__importDefault(require("./util/clean"));
const workspace_1 = tslib_1.__importDefault(require("./workspace"));
const debounce = require("debounce");
const logger = require('./util/logger')('plugin');
class Plugin extends events_1.EventEmitter {
    constructor(nvim) {
        super();
        this.nvim = nvim;
        this._ready = false;
        Object.defineProperty(workspace_1.default, 'nvim', {
            get: () => this.nvim
        });
        this.addMethod('hasSelected', () => {
            return completion_1.default.hasSelected();
        });
        this.addMethod('listNames', () => {
            return manager_2.default.names;
        });
        this.addMethod('codeActionRange', (start, end, only) => {
            return this.handler.codeActionRange(start, end, only);
        });
        this.addMethod('rootPatterns', bufnr => {
            let doc = workspace_1.default.getDocument(bufnr);
            if (!doc)
                return null;
            return {
                buffer: workspace_1.default.getRootPatterns(doc, types_1.PatternType.Buffer),
                server: workspace_1.default.getRootPatterns(doc, types_1.PatternType.LanguageServer),
                global: workspace_1.default.getRootPatterns(doc, types_1.PatternType.Global)
            };
        });
        this.addMethod('installExtensions', debounce(async () => {
            let list = await nvim.getVar('coc_global_extensions');
            await extensions_1.default.installExtensions(list);
        }, 200));
        this.addMethod('commandList', () => {
            return commands_1.default.commandList.map(o => o.id);
        });
        this.addMethod('openList', async (...args) => {
            await this.ready;
            await manager_2.default.start(args);
        });
        this.addMethod('runCommand', async (...args) => {
            await this.ready;
            return await this.handler.runCommand(...args);
        });
        this.addMethod('listResume', () => {
            return manager_2.default.resume();
        });
        this.addMethod('listPrev', () => {
            return manager_2.default.previous();
        });
        this.addMethod('listNext', () => {
            return manager_2.default.next();
        });
        this.addMethod('detach', () => {
            return workspace_1.default.detach();
        });
        this.addMethod('sendRequest', (id, method, params) => {
            return services_1.default.sendRequest(id, method, params);
        });
        this.addMethod('registNotification', async (id, method) => {
            await services_1.default.registNotification(id, method);
        });
        this.addMethod('doAutocmd', async (id, ...args) => {
            let autocmd = workspace_1.default.autocmds.get(id);
            if (autocmd)
                await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args));
        });
        this.addMethod('updateConfig', (section, val) => {
            workspace_1.default.configurations.updateUserConfig({ [section]: val });
        });
        this.addMethod('snippetNext', async () => {
            await manager_3.default.nextPlaceholder();
            return '';
        });
        this.addMethod('snippetPrev', async () => {
            await manager_3.default.previousPlaceholder();
            return '';
        });
        this.addMethod('snippetCancel', () => {
            manager_3.default.cancel();
        });
        this.addMethod('cocInstalled', async (names) => {
            for (let name of names.split(/\s+/)) {
                await extensions_1.default.onExtensionInstall(name);
            }
        });
        this.addMethod('openLog', () => {
            let file = logger.getLogFile();
            nvim.call(`coc#util#open_file`, ['edit', file], true);
        });
        this.addMethod('doKeymap', async (key, defaultReturn = '') => {
            let [fn, repeat] = workspace_1.default.keymaps.get(key);
            if (!fn) {
                logger.error(`keymap for ${key} not found`);
                return defaultReturn;
            }
            let res = await Promise.resolve(fn());
            if (repeat)
                await nvim.command(`silent! call repeat#set("\\<Plug>(coc-${key})", -1)`);
            return res || defaultReturn;
        });
        this.addMethod('registExtensions', async (...folders) => {
            for (let folder of folders) {
                await extensions_1.default.loadExtension(folder);
            }
        });
        workspace_1.default.onDidChangeWorkspaceFolders(() => {
            nvim.setVar('WorkspaceFolders', workspace_1.default.folderPaths, true);
        });
        commands_1.default.init(nvim, this);
        clean_1.default(); // tslint:disable-line
    }
    addMethod(name, fn) {
        Object.defineProperty(this, name, {
            value: fn
        });
    }
    addCommand(cmd) {
        let id = `vim.${cmd.id}`;
        commands_1.default.registerCommand(id, async () => {
            await this.nvim.command(cmd.cmd);
        });
        if (cmd.title)
            commands_1.default.titles.set(id, cmd.title);
    }
    async init() {
        let { nvim } = this;
        try {
            await extensions_1.default.init(nvim);
            await workspace_1.default.init();
            manager_1.default.init();
            manager_2.default.init(nvim);
            nvim.setVar('coc_workspace_initialized', 1, true);
            nvim.setVar('coc_process_pid', process.pid, true);
            nvim.setVar('WorkspaceFolders', workspace_1.default.folderPaths, true);
            completion_1.default.init(nvim);
            sources_1.default.init();
            this.handler = new handler_1.default(nvim);
            services_1.default.init();
            extensions_1.default.activateExtensions();
            nvim.setVar('coc_service_initialized', 1, true);
            nvim.call('coc#_init', [], true);
            this._ready = true;
            let cmds = await nvim.getVar('coc_vim_commands');
            if (cmds && cmds.length) {
                for (let cmd of cmds) {
                    this.addCommand(cmd);
                }
            }
            logger.info(`coc ${this.version} initialized with node: ${process.version}`);
            this.emit('ready');
        }
        catch (e) {
            this._ready = false;
            console.error(`Error on initialize: ${e.stack}`); // tslint:disable-line
            logger.error(e.stack);
        }
        workspace_1.default.onDidOpenTextDocument(async (doc) => {
            if (!doc.uri.endsWith('coc-settings.json'))
                return;
            if (extensions_1.default.has('coc-json') || extensions_1.default.isDisabled('coc-json'))
                return;
            workspace_1.default.showMessage(`Run :CocInstall coc-json for json intellisense`, 'more');
        });
    }
    get isReady() {
        return this._ready;
    }
    get ready() {
        if (this._ready)
            return Promise.resolve();
        return new Promise(resolve => {
            this.once('ready', () => {
                resolve();
            });
        });
    }
    async findLocations(id, method, params, openCommand) {
        let { document, position } = await workspace_1.default.getCurrentState();
        params = params || {};
        Object.assign(params, {
            textDocument: { uri: document.uri },
            position
        });
        let res = await services_1.default.sendRequest(id, method, params);
        if (!res) {
            workspace_1.default.showMessage(`Locations of "${method}" not found!`, 'warning');
            return;
        }
        let locations = [];
        if (Array.isArray(res)) {
            locations = res;
        }
        else if (res.hasOwnProperty('location') && res.hasOwnProperty('children')) {
            function getLocation(item) {
                locations.push(item.location);
                if (item.children && item.children.length) {
                    for (let loc of item.children) {
                        getLocation(loc);
                    }
                }
            }
            getLocation(res);
        }
        await this.handler.handleLocations(locations, openCommand);
    }
    async snippetCheck(checkExpand, checkJump) {
        if (checkExpand && !extensions_1.default.has('coc-snippets')) {
            // tslint:disable-next-line: no-console
            console.error('coc-snippets required for check expand status!');
            return false;
        }
        if (checkJump) {
            let jumpable = manager_3.default.jumpable();
            if (jumpable)
                return true;
        }
        if (checkExpand) {
            let api = extensions_1.default.getExtensionApi('coc-snippets');
            if (api && api.hasOwnProperty('expandable')) {
                let expandable = await Promise.resolve(api.expandable());
                if (expandable)
                    return true;
            }
        }
        return false;
    }
    get version() {
        return workspace_1.default.version + (process.env.REVISION ? '-' + process.env.REVISION : '');
    }
    async showInfo() {
        if (!this.infoChannel) {
            this.infoChannel = workspace_1.default.createOutputChannel('info');
        }
        else {
            this.infoChannel.clear();
        }
        let channel = this.infoChannel;
        channel.appendLine('## versions');
        channel.appendLine('');
        let out = await this.nvim.call('execute', ['version']);
        channel.appendLine('vim version: ' + out.trim().split('\n', 2)[0]);
        channel.appendLine('node version: ' + process.version);
        channel.appendLine('coc.nvim version: ' + this.version);
        channel.appendLine('term: ' + (process.env.TERM_PROGRAM || process.env.TERM));
        channel.appendLine('platform: ' + process.platform);
        channel.appendLine('');
        channel.appendLine('## Messages');
        let msgs = await this.nvim.call('coc#rpc#get_errors');
        channel.append(msgs.join('\n'));
        channel.appendLine('');
        for (let ch of workspace_1.default.outputChannels.values()) {
            if (ch.name !== 'info') {
                channel.appendLine(`## Output channel: ${ch.name}\n`);
                channel.append(ch.content);
                channel.appendLine('');
            }
        }
        channel.show();
    }
    updateExtension() {
        let { nvim } = this;
        let statusItem = workspace_1.default.createStatusBarItem(0, { progress: true });
        if (statusItem) {
            statusItem.text = 'Checking latest release';
            statusItem.show();
        }
        return new Promise((resolve, reject) => {
            const req = https_1.default.request('https://api.github.com/repos/neoclide/coc.nvim/releases/latest', res => {
                let content = '';
                res.on('data', d => {
                    content = content + d;
                });
                res.on('end', async () => {
                    try {
                        let obj = JSON.parse(content);
                        let latest = obj.tag_name.replace(/^v/, '');
                        if (semver_1.default.gt(latest, workspace_1.default.version)) {
                            console.error(`Please upgrade coc.nvim to latest version: ${latest}`); // tslint:disable-line
                        }
                        else {
                            let cwd = await nvim.call('coc#util#extension_root');
                            let yarncmd = await nvim.call('coc#util#yarn_cmd');
                            if (!yarncmd)
                                return;
                            if (statusItem)
                                statusItem.text = 'Upgrading coc extensions...';
                            await workspace_1.default.runCommand(`${yarncmd} upgrade --latest --ignore-engines`, cwd, 300000);
                            if (statusItem)
                                statusItem.dispose();
                        }
                        resolve();
                    }
                    catch (e) {
                        console.error(`Update error: ${e.message}`); // tslint:disable-line
                        if (statusItem)
                            statusItem.hide();
                        resolve();
                    }
                });
            });
            req.on('error', e => {
                reject(e);
            });
            req.setHeader('User-Agent', 'NodeJS');
            req.end();
        });
    }
    async cocAction(...args) {
        if (!this._ready)
            return;
        let { handler } = this;
        try {
            switch (args[0]) {
                case 'links': {
                    return await handler.links();
                }
                case 'openLink': {
                    return await handler.openLink();
                }
                case 'pickColor': {
                    return await handler.pickColor();
                }
                case 'colorPresentation': {
                    return await handler.pickPresentation();
                }
                case 'highlight': {
                    await handler.highlight();
                    break;
                }
                case 'fold': {
                    return await handler.fold(args[1]);
                }
                case 'startCompletion':
                    await completion_1.default.startCompletion(args[1]);
                    break;
                case 'sourceStat':
                    return sources_1.default.sourceStats();
                case 'refreshSource':
                    await sources_1.default.refresh(args[1]);
                    break;
                case 'toggleSource':
                    sources_1.default.toggleSource(args[1]);
                    break;
                case 'diagnosticInfo':
                    await manager_1.default.echoMessage();
                    break;
                case 'diagnosticNext':
                    await manager_1.default.jumpNext();
                    break;
                case 'diagnosticPrevious':
                    await manager_1.default.jumpPrevious();
                    break;
                case 'diagnosticList':
                    return manager_1.default.getDiagnosticList();
                case 'jumpDefinition':
                    return await handler.gotoDefinition(args[1]);
                case 'jumpDeclaration':
                    return await handler.gotoDeclaration(args[1]);
                case 'jumpImplementation':
                    return await handler.gotoImplementation(args[1]);
                case 'jumpTypeDefinition':
                    return await handler.gotoTypeDefinition(args[1]);
                case 'jumpReferences':
                    return await handler.gotoReferences(args[1]);
                case 'doHover':
                    return await handler.onHover();
                case 'showSignatureHelp':
                    return await handler.showSignatureHelp();
                case 'documentSymbols':
                    return await handler.getDocumentSymbols();
                case 'selectionRanges':
                    return await handler.getSelectionRanges();
                case 'rename':
                    await handler.rename(args[1]);
                    return;
                case 'workspaceSymbols':
                    this.nvim.command('CocList -I symbols', true);
                    return;
                case 'formatSelected':
                    return await handler.documentRangeFormatting(args[1]);
                case 'format':
                    return await handler.documentFormatting();
                case 'commands':
                    return await handler.getCommands();
                case 'services':
                    return services_1.default.getServiceStats();
                case 'toggleService':
                    return services_1.default.toggle(args[1]);
                case 'codeAction':
                    return handler.doCodeAction(args[1], args[2]);
                case 'doCodeAction':
                    return await handler.applyCodeAction(args[1]);
                case 'codeActions':
                    return await handler.getCurrentCodeActions(args[1]);
                case 'quickfixes':
                    return await handler.getCurrentCodeActions(args[1], [vscode_languageserver_types_1.CodeActionKind.QuickFix]);
                case 'codeLensAction':
                    return handler.doCodeLensAction();
                case 'runCommand':
                    return await handler.runCommand(...args.slice(1));
                case 'doQuickfix':
                    return await handler.doQuickfix();
                case 'repeatCommand':
                    return await commands_1.default.repeatCommand();
                case 'extensionStats':
                    return await extensions_1.default.getExtensionStates();
                case 'activeExtension':
                    return extensions_1.default.activate(args[1], false);
                case 'deactivateExtension':
                    return extensions_1.default.deactivate(args[1]);
                case 'reloadExtension':
                    return await extensions_1.default.reloadExtension(args[1]);
                case 'toggleExtension':
                    return await extensions_1.default.toggleExtension(args[1]);
                case 'uninstallExtension':
                    return await extensions_1.default.uninstallExtension(args.slice(1));
                case 'getCurrentFunctionSymbol':
                    return await handler.getCurrentFunctionSymbol();
                default:
                    workspace_1.default.showMessage(`unknown action ${args[0]}`, 'error');
            }
        }
        catch (e) {
            let message = e.hasOwnProperty('message') ? e.message : e.toString();
            if (!/\btimeout\b/.test(message)) {
                workspace_1.default.showMessage(`Error on '${args[0]}': ${message}`, 'error');
            }
            if (e.stack)
                logger.error(e.stack);
        }
    }
    async dispose() {
        this.removeAllListeners();
        manager_2.default.dispose();
        workspace_1.default.dispose();
        sources_1.default.dispose();
        await services_1.default.stopAll();
        services_1.default.dispose();
        if (this.handler) {
            this.handler.dispose();
        }
        manager_3.default.dispose();
        commands_1.default.dispose();
        completion_1.default.dispose();
        manager_1.default.dispose();
    }
}
exports.default = Plugin;
//# sourceMappingURL=plugin.js.map