"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const util_1 = tslib_1.__importDefault(require("util"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const which_1 = tslib_1.__importDefault(require("which"));
const configuration_1 = tslib_1.__importDefault(require("./configuration"));
const shape_1 = tslib_1.__importDefault(require("./configuration/shape"));
const events_1 = tslib_1.__importDefault(require("./events"));
const db_1 = tslib_1.__importDefault(require("./model/db"));
const task_1 = tslib_1.__importDefault(require("./model/task"));
const document_1 = tslib_1.__importDefault(require("./model/document"));
const fileSystemWatcher_1 = tslib_1.__importDefault(require("./model/fileSystemWatcher"));
const mru_1 = tslib_1.__importDefault(require("./model/mru"));
const outputChannel_1 = tslib_1.__importDefault(require("./model/outputChannel"));
const resolver_1 = tslib_1.__importDefault(require("./model/resolver"));
const status_1 = tslib_1.__importDefault(require("./model/status"));
const terminal_1 = tslib_1.__importDefault(require("./model/terminal"));
const willSaveHandler_1 = tslib_1.__importDefault(require("./model/willSaveHandler"));
const types_1 = require("./types");
const fs_2 = require("./util/fs");
const index_1 = require("./util/index");
const match_1 = require("./util/match");
const string_1 = require("./util/string");
const watchman_1 = tslib_1.__importDefault(require("./watchman"));
const uuid = require("uuid/v1");
const array_1 = require("./util/array");
const position_1 = require("./util/position");
const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
const logger = require('./util/logger')('workspace');
const CONFIG_FILE_NAME = 'coc-settings.json';
let NAME_SPACE = 1080;
class Workspace {
    constructor() {
        this.keymaps = new Map();
        this.resolver = new resolver_1.default();
        this.rootPatterns = new Map();
        this._workspaceFolders = [];
        this._insertMode = false;
        this._cwd = process.cwd();
        this._blocking = false;
        this._initialized = false;
        this._attached = false;
        this.buffers = new Map();
        this.autocmds = new Map();
        this.terminals = new Map();
        this.creatingSources = new Map();
        this.outputChannels = new Map();
        this.schemeProviderMap = new Map();
        this.namespaceMap = new Map();
        this.disposables = [];
        this.watchedOptions = new Set();
        this._disposed = false;
        this._onDidOpenDocument = new vscode_languageserver_protocol_1.Emitter();
        this._onDidCloseDocument = new vscode_languageserver_protocol_1.Emitter();
        this._onDidChangeDocument = new vscode_languageserver_protocol_1.Emitter();
        this._onWillSaveDocument = new vscode_languageserver_protocol_1.Emitter();
        this._onDidSaveDocument = new vscode_languageserver_protocol_1.Emitter();
        this._onDidChangeWorkspaceFolders = new vscode_languageserver_protocol_1.Emitter();
        this._onDidChangeConfiguration = new vscode_languageserver_protocol_1.Emitter();
        this._onDidWorkspaceInitialized = new vscode_languageserver_protocol_1.Emitter();
        this._onDidOpenTerminal = new vscode_languageserver_protocol_1.Emitter();
        this._onDidCloseTerminal = new vscode_languageserver_protocol_1.Emitter();
        this.onDidCloseTerminal = this._onDidCloseTerminal.event;
        this.onDidOpenTerminal = this._onDidOpenTerminal.event;
        this.onDidChangeWorkspaceFolders = this._onDidChangeWorkspaceFolders.event;
        this.onDidOpenTextDocument = this._onDidOpenDocument.event;
        this.onDidCloseTextDocument = this._onDidCloseDocument.event;
        this.onDidChangeTextDocument = this._onDidChangeDocument.event;
        this.onWillSaveTextDocument = this._onWillSaveDocument.event;
        this.onDidSaveTextDocument = this._onDidSaveDocument.event;
        this.onDidChangeConfiguration = this._onDidChangeConfiguration.event;
        this.onDidWorkspaceInitialized = this._onDidWorkspaceInitialized.event;
        let json = requireFunc('../package.json');
        this.version = json.version;
        this.configurations = this.createConfigurations();
        this.willSaveUntilHandler = new willSaveHandler_1.default(this);
        this.setupDynamicAutocmd = debounce_1.default(() => {
            this._setupDynamicAutocmd().catch(e => {
                logger.error(e);
            });
        }, global.hasOwnProperty('__TEST__') ? 0 : 100);
        this.setMessageLevel();
    }
    async init() {
        let { nvim } = this;
        this.statusLine = new status_1.default(nvim);
        this._env = await nvim.call('coc#util#vim_info');
        this._insertMode = this._env.mode.startsWith('insert');
        if (this._env.workspaceFolders) {
            this._workspaceFolders = this._env.workspaceFolders.map(f => {
                return {
                    uri: vscode_uri_1.URI.file(f).toString(),
                    name: path_1.default.dirname(f)
                };
            });
        }
        this.checkProcess();
        this.configurations.updateUserConfig(this._env.config);
        events_1.default.on('InsertEnter', () => {
            this._insertMode = true;
        }, null, this.disposables);
        events_1.default.on('InsertLeave', () => {
            this._insertMode = false;
        }, null, this.disposables);
        events_1.default.on('BufEnter', this.onBufEnter, this, this.disposables);
        events_1.default.on('CursorMoved', this.onCursorMoved, this, this.disposables);
        events_1.default.on('DirChanged', this.onDirChanged, this, this.disposables);
        events_1.default.on('BufCreate', this.onBufCreate, this, this.disposables);
        events_1.default.on('BufUnload', this.onBufUnload, this, this.disposables);
        events_1.default.on('TermOpen', this.onBufCreate, this, this.disposables);
        events_1.default.on('TermClose', this.onBufUnload, this, this.disposables);
        events_1.default.on('BufWritePost', this.onBufWritePost, this, this.disposables);
        events_1.default.on('BufWritePre', this.onBufWritePre, this, this.disposables);
        events_1.default.on('FileType', this.onFileTypeChange, this, this.disposables);
        events_1.default.on('CursorHold', this.checkBuffer, this, this.disposables);
        events_1.default.on('TextChanged', this.checkBuffer, this, this.disposables);
        events_1.default.on('BufReadCmd', this.onBufReadCmd, this, this.disposables);
        events_1.default.on('VimResized', (columns, lines) => {
            Object.assign(this._env, { columns, lines });
        }, null, this.disposables);
        await this.attach();
        this.initVimEvents();
        this.configurations.onDidChange(e => {
            this._onDidChangeConfiguration.fire(e);
        }, null, this.disposables);
        this.watchOption('runtimepath', (_, newValue) => {
            this._env.runtimepath = newValue;
        }, this.disposables);
        this.watchOption('iskeyword', (_, newValue) => {
            let doc = this.getDocument(this.bufnr);
            if (doc)
                doc.setIskeyword(newValue);
        }, this.disposables);
        this.watchOption('completeopt', async (_, newValue) => {
            this.env.completeOpt = newValue;
            if (!this._attached)
                return;
            if (this.insertMode) {
                let suggest = this.getConfiguration('suggest');
                if (suggest.get('autoTrigger') == 'always') {
                    console.error(`Some plugin change completeopt on insert mode!`); // tslint:disable-line
                }
            }
        }, this.disposables);
        this.watchGlobal('coc_enabled', async (oldValue, newValue) => {
            if (newValue == oldValue)
                return;
            if (newValue == 1) {
                await this.attach();
            }
            else {
                await this.detach();
            }
        }, this.disposables);
        let provider = {
            onDidChange: null,
            provideTextDocumentContent: async (uri) => {
                let channel = this.outputChannels.get(uri.path.slice(1));
                if (!channel)
                    return '';
                nvim.pauseNotification();
                nvim.command('setlocal nospell nofoldenable wrap noswapfile', true);
                nvim.command('setlocal buftype=nofile bufhidden=hide', true);
                nvim.command('setfiletype log', true);
                await nvim.resumeNotification();
                return channel.content;
            }
        };
        this.disposables.push(this.registerTextDocumentContentProvider('output', provider));
    }
    getConfigFile(target) {
        return this.configurations.getConfigFile(target);
    }
    /**
     * Register autocmd on vim.
     */
    registerAutocmd(autocmd) {
        let id = this.autocmds.size + 1;
        this.autocmds.set(id, autocmd);
        this.setupDynamicAutocmd();
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.autocmds.delete(id);
            this.setupDynamicAutocmd();
        });
    }
    /**
     * Watch for option change.
     */
    watchOption(key, callback, disposables) {
        let watching = this.watchedOptions.has(key);
        if (!watching) {
            this.watchedOptions.add(key);
            this.setupDynamicAutocmd();
        }
        let disposable = events_1.default.on('OptionSet', async (changed, oldValue, newValue) => {
            if (changed == key && callback) {
                await Promise.resolve(callback(oldValue, newValue));
            }
        });
        if (disposables) {
            disposables.push(vscode_languageserver_protocol_1.Disposable.create(() => {
                disposable.dispose();
                if (watching)
                    return;
                this.watchedOptions.delete(key);
                this.setupDynamicAutocmd();
            }));
        }
    }
    /**
     * Watch global variable, works on neovim only.
     */
    watchGlobal(key, callback, disposables) {
        let { nvim } = this;
        nvim.call('coc#_watch', key, true);
        let disposable = events_1.default.on('GlobalChange', async (changed, oldValue, newValue) => {
            if (changed == key && callback) {
                await Promise.resolve(callback(oldValue, newValue));
            }
        });
        if (disposables) {
            disposables.push(vscode_languageserver_protocol_1.Disposable.create(() => {
                disposable.dispose();
                nvim.call('coc#_unwatch', key, true);
            }));
        }
    }
    get cwd() {
        return this._cwd;
    }
    get env() {
        return this._env;
    }
    get root() {
        return this._root || this.cwd;
    }
    get rootPath() {
        return this.root;
    }
    get workspaceFolders() {
        return this._workspaceFolders;
    }
    /**
     * uri of current file, could be null
     */
    get uri() {
        let { bufnr } = this;
        if (bufnr) {
            let document = this.getDocument(bufnr);
            if (document && document.schema == 'file') {
                return document.uri;
            }
        }
        return null;
    }
    get workspaceFolder() {
        let { rootPath } = this;
        if (rootPath == os_1.default.homedir())
            return null;
        return {
            uri: vscode_uri_1.URI.file(rootPath).toString(),
            name: path_1.default.basename(rootPath)
        };
    }
    get textDocuments() {
        let docs = [];
        for (let b of this.buffers.values()) {
            docs.push(b.textDocument);
        }
        return docs;
    }
    get documents() {
        return Array.from(this.buffers.values());
    }
    createNameSpace(name = '') {
        if (this.namespaceMap.has(name))
            return this.namespaceMap.get(name);
        NAME_SPACE = NAME_SPACE + 1;
        this.namespaceMap.set(name, NAME_SPACE);
        return NAME_SPACE;
    }
    get channelNames() {
        return Array.from(this.outputChannels.keys());
    }
    get pluginRoot() {
        return path_1.default.dirname(__dirname);
    }
    get isVim() {
        return this._env.isVim;
    }
    get isNvim() {
        return !this._env.isVim;
    }
    get completeOpt() {
        return this._env.completeOpt;
    }
    get initialized() {
        return this._initialized;
    }
    get ready() {
        if (this._initialized)
            return Promise.resolve();
        return new Promise(resolve => {
            let disposable = this.onDidWorkspaceInitialized(() => {
                disposable.dispose();
                resolve();
            });
        });
    }
    /**
     * Current filetypes.
     */
    get filetypes() {
        let res = new Set();
        for (let doc of this.documents) {
            res.add(doc.filetype);
        }
        return res;
    }
    /**
     * Check if selector match document.
     */
    match(selector, document) {
        return match_1.score(selector, document.uri, document.languageId);
    }
    /**
     * Findup for filename or filenames from current filepath or root.
     */
    async findUp(filename) {
        let { cwd } = this;
        let filepath = await this.nvim.call('expand', '%:p');
        filepath = path_1.default.normalize(filepath);
        let isFile = filepath && path_1.default.isAbsolute(filepath);
        if (isFile && !fs_2.isParentFolder(cwd, filepath)) {
            // can't use cwd
            return fs_2.findUp(filename, path_1.default.dirname(filepath));
        }
        let res = fs_2.findUp(filename, cwd);
        if (res && res != os_1.default.homedir())
            return res;
        if (isFile)
            return fs_2.findUp(filename, path_1.default.dirname(filepath));
        return null;
    }
    async resolveRootFolder(uri, patterns) {
        let { cwd } = this;
        if (uri.scheme != 'file')
            return cwd;
        let filepath = path_1.default.normalize(uri.fsPath);
        let dir = path_1.default.dirname(filepath);
        return fs_2.resolveRoot(dir, patterns) || dir;
    }
    /**
     * Create a FileSystemWatcher instance,
     * doesn't fail when watchman not found.
     */
    createFileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete) {
        let watchmanPath = process.env.NODE_ENV == 'test' ? null : this.getWatchmanPath();
        let channel = watchmanPath ? this.createOutputChannel('watchman') : null;
        let promise = watchmanPath ? watchman_1.default.createClient(watchmanPath, this.root, channel) : Promise.resolve(null);
        let watcher = new fileSystemWatcher_1.default(promise, globPattern, !!ignoreCreate, !!ignoreChange, !!ignoreDelete);
        return watcher;
    }
    getWatchmanPath() {
        const preferences = this.getConfiguration('coc.preferences');
        let watchmanPath = preferences.get('watchmanPath', 'watchman');
        try {
            return which_1.default.sync(watchmanPath);
        }
        catch (e) {
            return null;
        }
    }
    /**
     * Get configuration by section and optional resource uri.
     */
    getConfiguration(section, resource) {
        return this.configurations.getConfiguration(section, resource);
    }
    /**
     * Get created document by uri or bufnr.
     */
    getDocument(uri) {
        if (typeof uri === 'number') {
            return this.buffers.get(uri);
        }
        uri = vscode_uri_1.URI.parse(uri).toString();
        for (let doc of this.buffers.values()) {
            if (doc && doc.uri === uri)
                return doc;
        }
        return null;
    }
    /**
     * Get current cursor offset in document.
     */
    async getOffset() {
        let document = await this.document;
        let pos = await this.getCursorPosition();
        return document.textDocument.offsetAt(pos);
    }
    /**
     * Apply WorkspaceEdit.
     */
    async applyEdit(edit) {
        let { nvim } = this;
        let { documentChanges, changes } = edit;
        if (documentChanges) {
            documentChanges = this.mergeDocumentChanges(documentChanges);
            if (!this.validteDocumentChanges(documentChanges))
                return false;
        }
        let pos = await this.getCursorPosition();
        let bufnr = await nvim.eval('bufnr("%")');
        let currUri = this.getDocument(bufnr) ? this.getDocument(bufnr).uri : null;
        let changed = null;
        try {
            if (documentChanges && documentChanges.length) {
                let n = documentChanges.length;
                for (let change of documentChanges) {
                    if (index_1.isDocumentEdit(change)) {
                        let { textDocument, edits } = change;
                        if (vscode_uri_1.URI.parse(textDocument.uri).toString() == currUri) {
                            changed = position_1.getChangedFromEdits(pos, edits);
                        }
                        let doc = await this.loadFile(textDocument.uri);
                        await doc.applyEdits(nvim, edits);
                    }
                    else if (vscode_languageserver_protocol_1.CreateFile.is(change)) {
                        let file = vscode_uri_1.URI.parse(change.uri).fsPath;
                        await this.createFile(file, change.options);
                    }
                    else if (vscode_languageserver_protocol_1.RenameFile.is(change)) {
                        await this.renameFile(vscode_uri_1.URI.parse(change.oldUri).fsPath, vscode_uri_1.URI.parse(change.newUri).fsPath, change.options);
                    }
                    else if (vscode_languageserver_protocol_1.DeleteFile.is(change)) {
                        await this.deleteFile(vscode_uri_1.URI.parse(change.uri).fsPath, change.options);
                    }
                }
                this.showMessage(`${n} buffers changed.`);
            }
            else if (changes) {
                for (let uri of Object.keys(changes)) {
                    let document = await this.loadFile(uri);
                    if (vscode_uri_1.URI.parse(uri).toString() == currUri) {
                        changed = position_1.getChangedFromEdits(pos, changes[uri]);
                    }
                    await document.applyEdits(nvim, changes[uri]);
                }
                this.showMessage(`${Object.keys(changes).length} buffers changed.`);
            }
            if (changed) {
                pos.line = pos.line + changed.line;
                pos.character = pos.character + changed.character;
            }
            await this.moveTo(pos);
        }
        catch (e) {
            // await nvim.setOption('eventignore', origIgnore)
            this.showMessage(`Error on applyEdits: ${e}`, 'error');
            return false;
        }
        return true;
    }
    /**
     * Convert location to quickfix item.
     */
    async getQuickfixItem(loc, text, type = '') {
        if (vscode_languageserver_protocol_1.LocationLink.is(loc)) {
            loc = vscode_languageserver_protocol_1.Location.create(loc.targetUri, loc.targetRange);
        }
        let doc = this.getDocument(loc.uri);
        let { uri, range } = loc;
        let { line, character } = range.start;
        let u = vscode_uri_1.URI.parse(uri);
        let bufnr = doc ? doc.bufnr : -1;
        if (!text && u.scheme == 'file') {
            text = await this.getLine(uri, line);
            character = string_1.byteIndex(text, character);
        }
        let item = {
            uri,
            filename: u.scheme == 'file' ? u.fsPath : uri,
            lnum: line + 1,
            col: character + 1,
            text: text || '',
            range
        };
        if (type)
            item.type = type;
        if (bufnr != -1)
            item.bufnr = bufnr;
        return item;
    }
    /**
     * Create persistence Mru instance.
     */
    createMru(name) {
        return new mru_1.default(name);
    }
    async getSelectedRange(mode, document) {
        let { nvim } = this;
        if (['v', 'V', 'char', 'line'].indexOf(mode) == -1) {
            this.showMessage(`Mode '${mode}' is not supported`, 'error');
            return null;
        }
        let isVisual = ['v', 'V'].indexOf(mode) != -1;
        let c = isVisual ? '<' : '[';
        await nvim.command('normal! `' + c);
        let start = await this.getOffset();
        c = isVisual ? '>' : ']';
        await nvim.command('normal! `' + c);
        let end = await this.getOffset() + 1;
        if (start == null || end == null || start == end) {
            this.showMessage(`Failed to get selected range`, 'error');
            return;
        }
        return {
            start: document.positionAt(start),
            end: document.positionAt(end)
        };
    }
    /**
     * Populate locations to UI.
     */
    async showLocations(locations) {
        let items = await Promise.all(locations.map(loc => {
            return this.getQuickfixItem(loc);
        }));
        let { nvim } = this;
        const preferences = this.getConfiguration('coc.preferences');
        if (preferences.get('useQuickfixForLocations', false)) {
            await nvim.call('setqflist', [items]);
            nvim.command('copen', true);
        }
        else {
            if (this.env.locationlist) {
                global.locations = items;
                nvim.command('CocList --normal --auto-preview location', true);
            }
            else {
                await nvim.setVar('coc_jump_locations', items);
                nvim.command('doautocmd User CocLocationsChange', true);
            }
        }
    }
    /**
     * Get content of line by uri and line.
     */
    async getLine(uri, line) {
        let document = this.getDocument(uri);
        if (document)
            return document.getline(line) || '';
        if (!uri.startsWith('file:'))
            return '';
        return await fs_2.readFileLine(vscode_uri_1.URI.parse(uri).fsPath, line);
    }
    /**
     * Get WorkspaceFolder of uri
     */
    getWorkspaceFolder(uri) {
        this.workspaceFolders.sort((a, b) => b.uri.length - a.uri.length);
        let filepath = vscode_uri_1.URI.parse(uri).fsPath;
        return this.workspaceFolders.find(folder => fs_2.isParentFolder(vscode_uri_1.URI.parse(folder.uri).fsPath, filepath));
    }
    /**
     * Get content from buffer of file by uri.
     */
    async readFile(uri) {
        let document = this.getDocument(uri);
        if (document) {
            document.forceSync();
            return document.content;
        }
        let u = vscode_uri_1.URI.parse(uri);
        if (u.scheme != 'file')
            return '';
        let encoding = await this.getFileEncoding();
        return await fs_2.readFile(u.fsPath, encoding);
    }
    getFilepath(filepath) {
        let { cwd } = this;
        let rel = path_1.default.relative(cwd, filepath);
        return rel.startsWith('..') ? filepath : rel;
    }
    onWillSaveUntil(callback, thisArg, clientId) {
        return this.willSaveUntilHandler.addCallback(callback, thisArg, clientId);
    }
    /**
     * Echo lines.
     */
    async echoLines(lines, truncate = false) {
        let { nvim } = this;
        let cmdHeight = this.env.cmdheight;
        if (lines.length > cmdHeight && truncate) {
            lines = lines.slice(0, cmdHeight);
        }
        let maxLen = this.env.columns - 12;
        lines = lines.map(line => {
            line = line.replace(/\n/g, ' ');
            if (truncate)
                line = line.slice(0, maxLen);
            return line;
        });
        if (truncate && lines.length == cmdHeight) {
            let last = lines[lines.length - 1];
            lines[cmdHeight - 1] = `${last.length == maxLen ? last.slice(0, -4) : last} ...`;
        }
        nvim.callTimer('coc#util#echo_lines', [lines], true);
    }
    /**
     * Show message in vim.
     */
    showMessage(msg, identify = 'more') {
        if (this._blocking || !this.nvim)
            return;
        let { messageLevel } = this;
        let level = types_1.MessageLevel.Error;
        let method = index_1.echoErr;
        switch (identify) {
            case 'more':
                level = types_1.MessageLevel.More;
                method = index_1.echoMessage;
                break;
            case 'warning':
                level = types_1.MessageLevel.Warning;
                method = index_1.echoWarning;
                break;
        }
        if (level >= messageLevel) {
            method(this.nvim, msg);
        }
    }
    /**
     * Current document.
     */
    get document() {
        let { bufnr } = this;
        if (bufnr == null)
            return null;
        if (this.buffers.has(bufnr)) {
            return Promise.resolve(this.buffers.get(bufnr));
        }
        if (!this.creatingSources.has(bufnr)) {
            this.onBufCreate(bufnr).catch(e => {
                logger.error('Error on buffer create:', e);
            });
        }
        return new Promise(resolve => {
            let disposable = this.onDidOpenTextDocument(doc => {
                disposable.dispose();
                resolve(this.getDocument(doc.uri));
            });
        });
    }
    /**
     * Get current cursor position.
     */
    async getCursorPosition() {
        let [line, character] = await this.nvim.call('coc#util#cursor');
        return vscode_languageserver_protocol_1.Position.create(line, character);
    }
    /**
     * Get current document and position.
     */
    async getCurrentState() {
        let document = await this.document;
        let position = await this.getCursorPosition();
        return {
            document: document.textDocument,
            position
        };
    }
    /**
     * Get format options
     */
    async getFormatOptions(uri) {
        let doc;
        if (uri) {
            doc = this.getDocument(uri);
        }
        else {
            doc = this.getDocument(this.bufnr);
        }
        let tabSize = await this.getDocumentOption('shiftwidth', doc);
        if (!tabSize)
            tabSize = await this.getDocumentOption('tabstop', doc);
        let insertSpaces = (await this.getDocumentOption('expandtab', doc)) == 1;
        return {
            tabSize,
            insertSpaces
        };
    }
    /**
     * Jump to location.
     */
    async jumpTo(uri, position, openCommand) {
        const preferences = this.getConfiguration('coc.preferences');
        let jumpCommand = openCommand || preferences.get('jumpCommand', 'edit');
        let { nvim } = this;
        let { line, character } = position || { line: 0, character: 0 };
        let doc = this.getDocument(uri);
        let col = character + 1;
        if (doc)
            col = string_1.byteLength(doc.getline(line).slice(0, character)) + 1;
        let bufnr = doc ? doc.bufnr : -1;
        await nvim.command(`normal! m'`);
        if (bufnr == this.bufnr && position && jumpCommand == 'edit') {
            await nvim.call('cursor', [line + 1, col]);
        }
        else if (bufnr != -1 && jumpCommand == 'edit') {
            let moveCmd = position ? `+call\\ cursor(${line + 1},${col})` : '';
            await this.nvim.call('coc#util#execute', [`buffer ${moveCmd} ${bufnr}`]);
        }
        else {
            let bufname = uri.startsWith('file:') ? path_1.default.normalize(vscode_uri_1.URI.parse(uri).fsPath) : uri;
            let pos = position ? [line + 1, col] : [];
            await this.nvim.call('coc#util#jump', [jumpCommand, bufname, pos]);
        }
    }
    /**
     * Move cursor to position.
     */
    async moveTo(position) {
        let { nvim } = this;
        let line = await nvim.call('getline', position.line + 1);
        let col = string_1.byteLength(line.slice(0, position.character)) + 1;
        await nvim.call('cursor', [position.line + 1, col]);
    }
    /**
     * Create a file in vim and disk
     */
    async createFile(filepath, opts = {}) {
        let stat = await fs_2.statAsync(filepath);
        if (stat && !opts.overwrite && !opts.ignoreIfExists) {
            this.showMessage(`${filepath} already exists!`, 'error');
            return;
        }
        if (!stat || opts.overwrite) {
            // directory
            if (filepath.endsWith('/')) {
                try {
                    if (filepath.startsWith('~'))
                        filepath = filepath.replace(/^~/, os_1.default.homedir());
                    await index_1.mkdirp(filepath);
                }
                catch (e) {
                    this.showMessage(`Can't create ${filepath}: ${e.message}`, 'error');
                }
            }
            else {
                let uri = vscode_uri_1.URI.file(filepath).toString();
                let doc = this.getDocument(uri);
                if (doc)
                    return;
                let encoding = await this.getFileEncoding();
                fs_1.default.writeFileSync(filepath, '', encoding || '');
                await this.loadFile(uri);
            }
        }
    }
    /**
     * Load uri as document.
     */
    async loadFile(uri) {
        let u = vscode_uri_1.URI.parse(uri);
        let doc = this.getDocument(uri);
        if (doc)
            return doc;
        let { nvim } = this;
        let filepath = u.scheme == 'file' ? u.fsPath : uri;
        let escaped = await nvim.call('fnameescape', filepath);
        let bufnr = await nvim.call('bufnr', '%');
        nvim.pauseNotification();
        nvim.command('setl bufhidden=hide', true);
        nvim.command(`keepalt edit ${escaped}`, true);
        nvim.command('setl bufhidden=hide', true);
        nvim.command(`keepalt buffer ${bufnr}`, true);
        return await new Promise((resolve, reject) => {
            let disposable = this.onDidOpenTextDocument(textDocument => {
                if (textDocument.uri == uri) {
                    clearTimeout(timer);
                    disposable.dispose();
                    resolve(this.getDocument(uri));
                }
            });
            let timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error(`Create document ${uri} timeout after 1s.`));
            }, 1000);
            nvim.resumeNotification(false, true).catch(_e => {
                // noop
            });
        });
    }
    /**
     * Rename file in vim and disk
     */
    async renameFile(oldPath, newPath, opts = {}) {
        let { overwrite, ignoreIfExists } = opts;
        let stat = await fs_2.statAsync(newPath);
        if (stat && !overwrite && !ignoreIfExists) {
            this.showMessage(`${newPath} already exists`, 'error');
            return;
        }
        if (!stat || overwrite) {
            try {
                await fs_2.renameAsync(oldPath, newPath);
                let uri = vscode_uri_1.URI.file(oldPath).toString();
                let doc = this.getDocument(uri);
                if (doc) {
                    await doc.buffer.setName(newPath);
                    // avoid cancel by unload
                    await this.onBufCreate(doc.bufnr);
                }
            }
            catch (e) {
                this.showMessage(`Rename error ${e.message}`, 'error');
            }
        }
    }
    /**
     * Delete file from vim and disk.
     */
    async deleteFile(filepath, opts = {}) {
        let { ignoreIfNotExists, recursive } = opts;
        let stat = await fs_2.statAsync(filepath.replace(/\/$/, ''));
        let isDir = stat && stat.isDirectory() || filepath.endsWith('/');
        if (!stat && !ignoreIfNotExists) {
            this.showMessage(`${filepath} not exists`, 'error');
            return;
        }
        if (stat == null)
            return;
        if (isDir && !recursive) {
            this.showMessage(`Can't remove directory, recursive not set`, 'error');
            return;
        }
        try {
            let method = isDir ? 'rmdir' : 'unlink';
            await util_1.default.promisify(fs_1.default[method])(filepath);
            if (!isDir) {
                let uri = vscode_uri_1.URI.file(filepath).toString();
                let doc = this.getDocument(uri);
                if (doc)
                    await this.nvim.command(`silent bwipeout ${doc.bufnr}`);
            }
        }
        catch (e) {
            this.showMessage(`Error on delete ${filepath}: ${e.message}`, 'error');
        }
    }
    /**
     * Open resource by uri
     */
    async openResource(uri) {
        let { nvim } = this;
        // not supported
        if (uri.startsWith('http')) {
            await nvim.call('coc#util#open_url', uri);
            return;
        }
        let wildignore = await nvim.getOption('wildignore');
        await nvim.setOption('wildignore', '');
        await this.jumpTo(uri);
        await nvim.setOption('wildignore', wildignore);
    }
    /**
     * Create a new output channel
     */
    createOutputChannel(name) {
        if (this.outputChannels.has(name))
            return this.outputChannels.get(name);
        let channel = new outputChannel_1.default(name, this.nvim);
        this.outputChannels.set(name, channel);
        return channel;
    }
    /**
     * Reveal buffer of output channel.
     */
    showOutputChannel(name) {
        let channel = this.outputChannels.get(name);
        if (!channel) {
            this.showMessage(`Channel "${name}" not found`, 'error');
            return;
        }
        channel.show(false);
    }
    /**
     * Resovle module from yarn or npm.
     */
    async resolveModule(name) {
        return await this.resolver.resolveModule(name);
    }
    /**
     * Run nodejs command
     */
    async runCommand(cmd, cwd, timeout) {
        cwd = cwd || this.cwd;
        return index_1.runCommand(cmd, { cwd }, timeout);
    }
    /**
     * Run command in vim terminal
     */
    async runTerminalCommand(cmd, cwd = this.cwd, keepfocus = false) {
        return await this.nvim.callAsync('coc#util#run_terminal', { cmd, cwd, keepfocus: keepfocus ? 1 : 0 });
    }
    async createTerminal(opts) {
        let cmd = opts.shellPath;
        let args = opts.shellArgs;
        if (!cmd)
            cmd = await this.nvim.getOption('shell');
        let terminal = new terminal_1.default(cmd, args || [], this.nvim, opts.name);
        await terminal.start(opts.cwd || this.cwd, opts.env);
        this.terminals.set(terminal.bufnr, terminal);
        this._onDidOpenTerminal.fire(terminal);
        return terminal;
    }
    /**
     * Show quickpick
     */
    async showQuickpick(items, placeholder = 'Choose by number') {
        let msgs = [placeholder + ':'];
        msgs = msgs.concat(items.map((str, index) => {
            return `${index + 1}. ${str}`;
        }));
        let res = await this.nvim.call('inputlist', [msgs]);
        let n = parseInt(res, 10);
        if (isNaN(n) || n <= 0 || n > msgs.length)
            return -1;
        return n - 1;
    }
    /**
     * Prompt for confirm action.
     */
    async showPrompt(title) {
        this._blocking = true;
        let res = await this.nvim.callAsync('coc#util#with_callback', ['coc#util#prompt_confirm', [title]]);
        this._blocking = false;
        return res == 1;
    }
    async callAsync(method, args) {
        if (this.isNvim)
            return await this.nvim.call(method, args);
        return await this.nvim.callAsync('coc#util#with_callback', [method, args]);
    }
    /**
     * Request input from user
     */
    async requestInput(title, defaultValue) {
        let { nvim } = this;
        let res = await nvim.call('input', [title + ':', defaultValue || '']);
        nvim.command('normal! :<C-u>', true);
        if (!res) {
            this.showMessage('Empty word, canceled', 'warning');
            return null;
        }
        return res;
    }
    /**
     * registerTextDocumentContentProvider
     */
    registerTextDocumentContentProvider(scheme, provider) {
        this.schemeProviderMap.set(scheme, provider);
        this.setupDynamicAutocmd(); // tslint:disable-line
        let disposables = [];
        if (provider.onDidChange) {
            provider.onDidChange(async (uri) => {
                let doc = this.getDocument(uri.toString());
                if (doc) {
                    let { buffer } = doc;
                    let tokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
                    let content = await Promise.resolve(provider.provideTextDocumentContent(uri, tokenSource.token));
                    await buffer.setLines(content.split('\n'), {
                        start: 0,
                        end: -1,
                        strictIndexing: false
                    });
                }
            }, null, disposables);
        }
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.schemeProviderMap.delete(scheme);
            index_1.disposeAll(disposables);
            this.setupDynamicAutocmd();
        });
    }
    /**
     * Register keymap
     */
    registerKeymap(modes, key, fn, opts = {}) {
        if (this.keymaps.has(key))
            return;
        opts = Object.assign({ sync: true, cancel: true, silent: true, repeat: false }, opts);
        let { nvim } = this;
        this.keymaps.set(key, [fn, !!opts.repeat]);
        let method = opts.sync ? 'request' : 'notify';
        let silent = opts.silent ? '<silent>' : '';
        for (let m of modes) {
            if (m == 'i') {
                nvim.command(`imap ${silent}<expr> <Plug>(coc-${key}) coc#_insert_key('${method}', '${key}', ${opts.cancel ? 1 : 0})`, true);
            }
            else {
                let modify = this.isNvim ? '<Cmd>' : index_1.getKeymapModifier(m);
                nvim.command(`${m}map ${silent} <Plug>(coc-${key}) ${modify}:call coc#rpc#${method}('doKeymap', ['${key}'])<cr>`, true);
            }
        }
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.keymaps.delete(key);
            for (let m of modes) {
                nvim.command(`${m}unmap <Plug>(coc-${key})`, true);
            }
        });
    }
    /**
     * Register expr keymap.
     */
    registerExprKeymap(mode, key, fn, buffer = false) {
        let id = uuid();
        let { nvim } = this;
        this.keymaps.set(id, [fn, false]);
        if (mode == 'i') {
            nvim.command(`inoremap <silent><expr>${buffer ? '<nowait><buffer>' : ''} ${key} coc#_insert_key('request', '${id}')`, true);
        }
        else {
            nvim.command(`${mode}noremap <silent><expr>${buffer ? '<nowait><buffer>' : ''} ${key} coc#rpc#request('doKeymap', ['${id}'])`, true);
        }
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.keymaps.delete(id);
            nvim.command(`${mode}unmap ${buffer ? '<buffer>' : ''} ${key}`, true);
        });
    }
    /**
     * Create StatusBarItem
     */
    createStatusBarItem(priority = 0, opt = {}) {
        if (!this.statusLine)
            return null;
        return this.statusLine.createStatusBarItem(priority, opt.progress || false);
    }
    dispose() {
        this._disposed = true;
        for (let ch of this.outputChannels.values()) {
            ch.dispose();
        }
        for (let doc of this.documents) {
            doc.detach();
        }
        index_1.disposeAll(this.disposables);
        watchman_1.default.dispose();
        this.configurations.dispose();
        this.setupDynamicAutocmd.clear();
        this.buffers.clear();
        if (this.statusLine)
            this.statusLine.dispose();
    }
    async detach() {
        if (!this._attached)
            return;
        this._attached = false;
        for (let bufnr of this.buffers.keys()) {
            await events_1.default.fire('BufUnload', [bufnr]);
        }
    }
    /**
     * Create DB instance at extension root.
     */
    createDatabase(name) {
        let root = path_1.default.dirname(this.env.extensionRoot);
        let filepath = path_1.default.join(root, name + '.json');
        return new db_1.default(filepath);
    }
    /**
     * Create Task instance that runs in vim.
     */
    createTask(id) {
        return new task_1.default(this.nvim, id);
    }
    async _setupDynamicAutocmd() {
        let schemes = this.schemeProviderMap.keys();
        let cmds = [];
        for (let scheme of schemes) {
            cmds.push(`autocmd BufReadCmd,FileReadCmd,SourceCmd ${scheme}://* call coc#rpc#request('CocAutocmd', ['BufReadCmd','${scheme}', expand('<amatch>')])`);
        }
        for (let [id, autocmd] of this.autocmds.entries()) {
            let args = autocmd.arglist && autocmd.arglist.length ? ', ' + autocmd.arglist.join(', ') : '';
            let event = Array.isArray(autocmd.event) ? autocmd.event.join(' ') : autocmd.event;
            cmds.push(`autocmd ${event} * call coc#rpc#${autocmd.request ? 'request' : 'notify'}('doAutocmd', [${id}${args}])`);
        }
        for (let key of this.watchedOptions) {
            cmds.push(`autocmd OptionSet ${key} call coc#rpc#notify('OptionSet',[expand('<amatch>'), v:option_old, v:option_new])`);
        }
        let content = `
augroup coc_autocmd
  autocmd!
  ${cmds.join('\n')}
augroup end`;
        try {
            let filepath = path_1.default.join(os_1.default.tmpdir(), `coc-${process.pid}.vim`);
            await fs_2.writeFile(filepath, content);
            await this.nvim.command(`source ${filepath}`);
        }
        catch (e) {
            this.showMessage(`Can't create tmp file: ${e.message}`, 'error');
        }
    }
    async onBufReadCmd(scheme, uri) {
        let provider = this.schemeProviderMap.get(scheme);
        if (!provider) {
            this.showMessage(`Provider for ${scheme} not found`, 'error');
            return;
        }
        let tokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        let content = await Promise.resolve(provider.provideTextDocumentContent(vscode_uri_1.URI.parse(uri), tokenSource.token));
        let buf = await this.nvim.buffer;
        await buf.setLines(content.split('\n'), {
            start: 0,
            end: -1,
            strictIndexing: false
        });
        setTimeout(async () => {
            await events_1.default.fire('BufCreate', [buf.id]);
        }, 30);
    }
    async attach() {
        if (this._attached)
            return;
        this._attached = true;
        let buffers = await this.nvim.buffers;
        let bufnr = this.bufnr = await this.nvim.call('bufnr', '%');
        await Promise.all(buffers.map(buf => {
            return this.onBufCreate(buf);
        }));
        if (!this._initialized) {
            this._onDidWorkspaceInitialized.fire(void 0);
            this._initialized = true;
        }
        await events_1.default.fire('BufEnter', [bufnr]);
        let winid = await this.nvim.call('win_getid');
        await events_1.default.fire('BufWinEnter', [bufnr, winid]);
    }
    validteDocumentChanges(documentChanges) {
        if (!documentChanges)
            return true;
        for (let change of documentChanges) {
            if (index_1.isDocumentEdit(change)) {
                let { textDocument } = change;
                let { uri, version } = textDocument;
                let doc = this.getDocument(uri);
                if (version && !doc) {
                    this.showMessage(`${uri} not opened.`, 'error');
                    return false;
                }
                if (version && doc.version != version) {
                    this.showMessage(`${uri} changed before apply edit`, 'error');
                    return false;
                }
                if (!version && !doc) {
                    if (!uri.startsWith('file')) {
                        this.showMessage(`Can't apply edits to ${uri}.`, 'error');
                        return false;
                    }
                    let exists = fs_1.default.existsSync(vscode_uri_1.URI.parse(uri).fsPath);
                    if (!exists) {
                        this.showMessage(`File ${uri} not exists.`, 'error');
                        return false;
                    }
                }
            }
            else if (vscode_languageserver_protocol_1.CreateFile.is(change) || vscode_languageserver_protocol_1.DeleteFile.is(change)) {
                if (!fs_2.isFile(change.uri)) {
                    this.showMessage(`Chagne of scheme ${change.uri} not supported`, 'error');
                    return false;
                }
            }
        }
        return true;
    }
    createConfigurations() {
        let home = process.env.VIMCONFIG || path_1.default.join(os_1.default.homedir(), '.vim');
        if (global.hasOwnProperty('__TEST__')) {
            home = path_1.default.join(this.pluginRoot, 'src/__tests__');
        }
        let userConfigFile = path_1.default.join(home, CONFIG_FILE_NAME);
        return new configuration_1.default(userConfigFile, new shape_1.default(this));
    }
    // events for sync buffer of vim
    initVimEvents() {
        if (!this.isVim)
            return;
        const onChange = async (bufnr) => {
            let doc = this.getDocument(bufnr);
            if (doc && doc.shouldAttach)
                doc.fetchContent();
        };
        events_1.default.on('TextChangedI', onChange, null, this.disposables);
        events_1.default.on('TextChanged', onChange, null, this.disposables);
    }
    async onBufCreate(buf) {
        let buffer = typeof buf === 'number' ? this.nvim.createBuffer(buf) : buf;
        let bufnr = buffer.id;
        if (this.creatingSources.has(bufnr))
            return;
        let document = this.getDocument(bufnr);
        try {
            if (document)
                this.onBufUnload(bufnr, true);
            document = new document_1.default(buffer, this._env);
            let source = new vscode_languageserver_protocol_1.CancellationTokenSource();
            let token = source.token;
            this.creatingSources.set(bufnr, source);
            let created = await document.init(this.nvim, token);
            if (!created || document.getVar('enabled', 1) === 0)
                document = null;
            if (this.creatingSources.get(bufnr) == source) {
                source.dispose();
                this.creatingSources.delete(bufnr);
            }
        }
        catch (e) {
            logger.error('Error on create buffer:', e);
        }
        if (!document)
            return;
        this.buffers.set(bufnr, document);
        document.onDocumentDetach(uri => {
            let doc = this.getDocument(uri);
            if (doc)
                this.onBufUnload(doc.bufnr);
        });
        if (document.buftype == '' && document.schema == 'file') {
            let config = this.getConfiguration('workspace');
            let filetypes = config.get('ignoredFiletypes', []);
            if (filetypes.indexOf(document.filetype) == -1) {
                let root = this.resolveRoot(document);
                if (root) {
                    this.addWorkspaceFolder(root);
                    if (this.bufnr == buffer.id) {
                        this._root = root;
                    }
                }
            }
            this.configurations.checkFolderConfiguration(document.uri);
        }
        this._onDidOpenDocument.fire(document.textDocument);
        document.onDocumentChange(({ textDocument, contentChanges }) => {
            let { version, uri } = textDocument;
            this._onDidChangeDocument.fire({
                textDocument: { version, uri },
                contentChanges
            });
        });
        logger.debug('buffer created', buffer.id);
    }
    async onBufEnter(bufnr) {
        this.bufnr = bufnr;
        let doc = this.getDocument(bufnr);
        if (doc) {
            this.configurations.setFolderConfiguration(doc.uri);
            let workspaceFolder = this.getWorkspaceFolder(doc.uri);
            if (workspaceFolder)
                this._root = vscode_uri_1.URI.parse(workspaceFolder.uri).fsPath;
        }
    }
    async onCursorMoved(bufnr) {
        this.bufnr = bufnr;
        await this.checkBuffer(bufnr);
    }
    async onBufWritePost(bufnr) {
        let doc = this.buffers.get(bufnr);
        if (!doc)
            return;
        this._onDidSaveDocument.fire(doc.textDocument);
    }
    onBufUnload(bufnr, recreate = false) {
        if (!recreate) {
            let source = this.creatingSources.get(bufnr);
            if (source) {
                source.cancel();
                this.creatingSources.delete(bufnr);
            }
        }
        if (this.terminals.has(bufnr)) {
            let terminal = this.terminals.get(bufnr);
            this._onDidCloseTerminal.fire(terminal);
            this.terminals.delete(bufnr);
        }
        let doc = this.buffers.get(bufnr);
        if (doc) {
            this._onDidCloseDocument.fire(doc.textDocument);
            this.buffers.delete(bufnr);
            if (!recreate)
                doc.detach();
        }
        logger.debug('buffer unload', bufnr);
    }
    async onBufWritePre(bufnr) {
        let doc = this.buffers.get(bufnr);
        if (!doc)
            return;
        let event = {
            document: doc.textDocument,
            reason: vscode_languageserver_protocol_1.TextDocumentSaveReason.Manual
        };
        this._onWillSaveDocument.fire(event);
        if (this.willSaveUntilHandler.hasCallback) {
            await this.willSaveUntilHandler.handeWillSaveUntil(event);
        }
    }
    onDirChanged(cwd) {
        if (cwd == this._cwd)
            return;
        this._cwd = cwd;
    }
    onFileTypeChange(filetype, bufnr) {
        let doc = this.getDocument(bufnr);
        if (!doc)
            return;
        let converted = doc.convertFiletype(filetype);
        if (converted == doc.filetype)
            return;
        this._onDidCloseDocument.fire(doc.textDocument);
        doc.setFiletype(filetype);
        this._onDidOpenDocument.fire(doc.textDocument);
    }
    async checkBuffer(bufnr) {
        if (this._disposed)
            return;
        let doc = this.getDocument(bufnr);
        if (!doc && !this.creatingSources.has(bufnr))
            await this.onBufCreate(bufnr);
    }
    async getFileEncoding() {
        let encoding = await this.nvim.getOption('fileencoding');
        return encoding ? encoding : 'utf-8';
    }
    resolveRoot(document) {
        let types = [types_1.PatternType.Buffer, types_1.PatternType.LanguageServer, types_1.PatternType.Global];
        let u = vscode_uri_1.URI.parse(document.uri);
        let dir = path_1.default.dirname(u.fsPath);
        for (let patternType of types) {
            let patterns = this.getRootPatterns(document, patternType);
            if (patterns && patterns.length) {
                let root = fs_2.resolveRoot(dir, patterns, this.cwd);
                if (root)
                    return root;
            }
        }
        if (this.cwd != os_1.default.homedir() && fs_2.isParentFolder(this.cwd, dir))
            return this.cwd;
        return null;
    }
    getRootPatterns(document, patternType) {
        let { uri } = document;
        if (patternType == types_1.PatternType.Buffer)
            return document.rootPatterns;
        if (patternType == types_1.PatternType.LanguageServer)
            return this.getServerRootPatterns(document.filetype);
        const preferences = this.getConfiguration('coc.preferences', uri);
        return preferences.get('rootPatterns', ['.vim', '.git', '.hg', '.projections.json']).slice();
    }
    async renameCurrent() {
        let { nvim } = this;
        let bufnr = await nvim.call('bufnr', '%');
        let cwd = await nvim.call('getcwd');
        let doc = this.getDocument(bufnr);
        if (!doc || doc.buftype != '' || doc.schema != 'file') {
            nvim.errWriteLine('current buffer is not file.');
            return;
        }
        let oldPath = vscode_uri_1.URI.parse(doc.uri).fsPath;
        let newPath = await nvim.call('input', ['new path:', oldPath, 'file']);
        newPath = newPath ? newPath.trim() : null;
        if (newPath == oldPath || !newPath)
            return;
        let lines = await doc.buffer.lines;
        let exists = fs_1.default.existsSync(oldPath);
        if (exists) {
            let modified = await nvim.eval('&modified');
            if (modified)
                await nvim.command('noa w');
            if (oldPath.toLowerCase() != newPath.toLowerCase() && fs_1.default.existsSync(newPath)) {
                let overwrite = await this.showPrompt(`${newPath} exists, overwrite?`);
                if (!overwrite)
                    return;
                fs_1.default.unlinkSync(newPath);
            }
            fs_1.default.renameSync(oldPath, newPath);
        }
        let filepath = fs_2.isParentFolder(cwd, newPath) ? path_1.default.relative(cwd, newPath) : newPath;
        let cursor = await nvim.call('getcurpos');
        nvim.pauseNotification();
        nvim.command(`keepalt ${bufnr}bwipeout!`, true);
        nvim.call('coc#util#open_file', ['keepalt edit', filepath], true);
        if (!exists && lines.join('\n') != '\n') {
            nvim.call('append', [0, lines], true);
            nvim.command('normal! Gdd', true);
        }
        nvim.call('setpos', ['.', cursor], true);
        await nvim.resumeNotification();
    }
    setMessageLevel() {
        let config = this.getConfiguration('coc.preferences');
        let level = config.get('messageLevel', 'more');
        switch (level) {
            case 'error':
                this.messageLevel = types_1.MessageLevel.Error;
                break;
            case 'warning':
                this.messageLevel = types_1.MessageLevel.Warning;
                break;
            default:
                this.messageLevel = types_1.MessageLevel.More;
        }
    }
    mergeDocumentChanges(changes) {
        let res = [];
        let documentEdits = [];
        for (let change of changes) {
            if (index_1.isDocumentEdit(change)) {
                let { edits, textDocument } = change;
                let documentEdit = documentEdits.find(o => o.textDocument.uri == textDocument.uri && o.textDocument.version === textDocument.version);
                if (documentEdit) {
                    documentEdit.edits.push(...edits);
                }
                else {
                    documentEdits.push(change);
                }
            }
            else {
                res.push(change);
            }
        }
        res.push(...documentEdits);
        return res;
    }
    get folderPaths() {
        return this.workspaceFolders.map(f => vscode_uri_1.URI.parse(f.uri).fsPath);
    }
    removeWorkspaceFolder(fsPath) {
        let idx = this._workspaceFolders.findIndex(f => vscode_uri_1.URI.parse(f.uri).fsPath == fsPath);
        if (idx != -1) {
            let folder = this._workspaceFolders[idx];
            this._workspaceFolders.splice(idx, 1);
            this._onDidChangeWorkspaceFolders.fire({
                removed: [folder],
                added: []
            });
        }
    }
    renameWorkspaceFolder(oldPath, newPath) {
        let idx = this._workspaceFolders.findIndex(f => vscode_uri_1.URI.parse(f.uri).fsPath == oldPath);
        if (idx == -1)
            return;
        let removed = this._workspaceFolders[idx];
        let added = {
            uri: vscode_uri_1.URI.file(newPath).toString(),
            name: path_1.default.dirname(newPath)
        };
        this._workspaceFolders.splice(idx, 1);
        this._workspaceFolders.push(added);
        this._onDidChangeWorkspaceFolders.fire({
            removed: [removed],
            added: [added]
        });
    }
    addRootPatterns(filetype, rootPatterns) {
        let patterns = this.rootPatterns.get(filetype) || [];
        for (let p of rootPatterns) {
            if (patterns.indexOf(p) == -1) {
                patterns.push(p);
            }
        }
        this.rootPatterns.set(filetype, patterns);
    }
    get insertMode() {
        return this._insertMode;
    }
    getDocumentOption(name, doc) {
        if (doc) {
            return doc.buffer.getOption(name).catch(_e => {
                return this.nvim.getOption(name);
            });
        }
        return this.nvim.getOption(name);
    }
    checkProcess() {
        if (global.hasOwnProperty('__TEST__'))
            return;
        let pid = this._env.pid;
        let interval = setInterval(() => {
            if (!index_1.isRunning(pid)) {
                process.exit();
            }
        }, 15000);
        process.on('exit', () => {
            clearInterval(interval);
        });
    }
    addWorkspaceFolder(rootPath) {
        if (rootPath == os_1.default.homedir())
            return;
        let { _workspaceFolders } = this;
        let uri = vscode_uri_1.URI.file(rootPath).toString();
        let workspaceFolder = { uri, name: path_1.default.basename(rootPath) };
        if (_workspaceFolders.findIndex(o => o.uri == uri) == -1) {
            _workspaceFolders.push(workspaceFolder);
            if (this._initialized) {
                this._onDidChangeWorkspaceFolders.fire({
                    added: [workspaceFolder],
                    removed: []
                });
            }
        }
        return workspaceFolder;
    }
    getServerRootPatterns(filetype) {
        let lspConfig = this.getConfiguration().get('languageserver', {});
        let patterns = [];
        for (let key of Object.keys(lspConfig)) {
            let config = lspConfig[key];
            let { filetypes, rootPatterns } = config;
            if (filetypes && rootPatterns && filetypes.indexOf(filetype) !== -1) {
                patterns.push(...rootPatterns);
            }
        }
        patterns = patterns.concat(this.rootPatterns.get(filetype) || []);
        return patterns.length ? array_1.distinct(patterns) : null;
    }
}
exports.Workspace = Workspace;
exports.default = new Workspace();
//# sourceMappingURL=workspace.js.map