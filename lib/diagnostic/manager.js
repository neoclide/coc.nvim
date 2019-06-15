"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const events_1 = tslib_1.__importDefault(require("../events"));
const floatFactory_1 = tslib_1.__importDefault(require("../model/floatFactory"));
const util_1 = require("../util");
const position_1 = require("../util/position");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const buffer_1 = require("./buffer");
const collection_1 = tslib_1.__importDefault(require("./collection"));
const util_2 = require("./util");
const logger = require('../util/logger')('diagnostic-manager');
class DiagnosticManager {
    constructor() {
        this.enabled = true;
        this.buffers = [];
        this.collections = [];
        this.disposables = [];
        this.lastMessage = '';
    }
    init() {
        this.setConfiguration();
        let { nvim } = workspace_1.default;
        let { maxWindowHeight } = this.config;
        this.floatFactory = new floatFactory_1.default(nvim, workspace_1.default.env, false, maxWindowHeight);
        this.disposables.push(vscode_languageserver_protocol_1.Disposable.create(() => {
            if (this.timer)
                clearTimeout(this.timer);
        }));
        events_1.default.on('CursorMoved', async () => {
            if (this.timer)
                clearTimeout(this.timer);
            this.timer = setTimeout(async () => {
                if (this.config.enableMessage != 'always')
                    return;
                if (this.config.messageTarget == 'float')
                    return;
                await this.echoMessage(true);
            }, 500);
        }, null, this.disposables);
        if (this.config.messageTarget == 'float') {
            this.disposables.push(workspace_1.default.registerAutocmd({
                event: 'CursorHold',
                request: true,
                callback: async () => {
                    await this.echoMessage(true);
                }
            }));
        }
        events_1.default.on('InsertEnter', async () => {
            this.floatFactory.close();
            if (this.timer)
                clearTimeout(this.timer);
        }, null, this.disposables);
        events_1.default.on('InsertLeave', async (bufnr) => {
            this.floatFactory.close();
            let doc = workspace_1.default.getDocument(bufnr);
            if (!doc || !this.shouldValidate(doc))
                return;
            let { refreshOnInsertMode, refreshAfterSave } = this.config;
            if (!refreshOnInsertMode && !refreshAfterSave) {
                await util_1.wait(500);
                this.refreshBuffer(doc.uri);
            }
        }, null, this.disposables);
        events_1.default.on('BufEnter', async (bufnr) => {
            if (this.timer)
                clearTimeout(this.timer);
            if (!this.config || !this.enabled || !this.config.locationlist)
                return;
            let doc = workspace_1.default.getDocument(bufnr);
            if (!this.shouldValidate(doc) || doc.bufnr != bufnr)
                return;
            let refreshed = this.refreshBuffer(doc.uri);
            if (!refreshed) {
                let winid = await nvim.call('win_getid');
                let curr = await nvim.call('getloclist', [winid, { title: 1 }]);
                if ((curr.title && curr.title.indexOf('Diagnostics of coc') != -1)) {
                    nvim.call('setloclist', [winid, [], 'f'], true);
                }
            }
        }, null, this.disposables);
        events_1.default.on('BufUnload', async (bufnr) => {
            let idx = this.buffers.findIndex(buf => buf.bufnr == bufnr);
            if (idx == -1)
                return;
            let buf = this.buffers[idx];
            buf.dispose();
            this.buffers.splice(idx, 1);
            for (let collection of this.collections) {
                collection.delete(buf.uri);
            }
            await buf.clear();
        }, null, this.disposables);
        events_1.default.on('BufWritePost', async (bufnr) => {
            let buf = this.buffers.find(buf => buf.bufnr == bufnr);
            if (buf)
                await buf.checkSigns();
            await util_1.wait(100);
            if (this.config.refreshAfterSave) {
                this.refreshBuffer(buf.uri);
            }
        }, null, this.disposables);
        workspace_1.default.onDidChangeConfiguration(async (e) => {
            this.setConfiguration(e);
        }, null, this.disposables);
        // create buffers
        for (let doc of workspace_1.default.documents) {
            this.createDiagnosticBuffer(doc);
        }
        workspace_1.default.onDidOpenTextDocument(textDocument => {
            let doc = workspace_1.default.getDocument(textDocument.uri);
            this.createDiagnosticBuffer(doc);
        }, null, this.disposables);
        this.setConfigurationErrors(true);
        workspace_1.default.configurations.onError(async () => {
            this.setConfigurationErrors();
        }, null, this.disposables);
        let { errorSign, warningSign, infoSign, hintSign } = this.config;
        nvim.pauseNotification();
        nvim.command(`sign define CocError   text=${errorSign}   linehl=CocErrorLine texthl=CocErrorSign`, true);
        nvim.command(`sign define CocWarning text=${warningSign} linehl=CocWarningLine texthl=CocWarningSign`, true);
        nvim.command(`sign define CocInfo    text=${infoSign}    linehl=CocInfoLine  texthl=CocInfoSign`, true);
        nvim.command(`sign define CocHint    text=${hintSign}    linehl=CocHintLine  texthl=CocHintSign`, true);
        if (this.config.virtualText) {
            nvim.call('coc#util#init_virtual_hl', [], true);
        }
        nvim.resumeNotification(false, true).catch(_e => {
            // noop
        });
    }
    createDiagnosticBuffer(doc) {
        if (!this.shouldValidate(doc))
            return;
        let idx = this.buffers.findIndex(b => b.bufnr == doc.bufnr);
        if (idx == -1) {
            let buf = new buffer_1.DiagnosticBuffer(doc, this.config);
            this.buffers.push(buf);
            buf.onDidRefresh(() => {
                if (workspace_1.default.insertMode)
                    return;
                this.echoMessage(true).catch(_e => {
                    // noop
                });
            });
        }
    }
    setConfigurationErrors(init) {
        let collections = this.collections;
        let collection = collections.find(o => o.name == 'config');
        if (!collection) {
            collection = this.create('config');
        }
        else {
            collection.clear();
        }
        let { errorItems } = workspace_1.default.configurations;
        if (errorItems && errorItems.length) {
            if (init)
                workspace_1.default.showMessage(`settings file parse error, run ':CocList diagnostics'`, 'error');
            let entries = new Map();
            for (let item of errorItems) {
                let { uri } = item.location;
                let diagnostics = entries.get(uri) || [];
                diagnostics.push(vscode_languageserver_protocol_1.Diagnostic.create(item.location.range, item.message, vscode_languageserver_protocol_1.DiagnosticSeverity.Error));
                entries.set(uri, diagnostics);
            }
            collection.set(Array.from(entries));
        }
    }
    /**
     * Create collection by name
     */
    create(name) {
        let collection = new collection_1.default(name);
        this.collections.push(collection);
        let disposable = collection.onDidDiagnosticsChange(async (uri) => {
            if (this.config.refreshAfterSave)
                return;
            this.refreshBuffer(uri);
        });
        let dispose = collection.onDidDiagnosticsClear(uris => {
            for (let uri of uris) {
                this.refreshBuffer(uri);
            }
        });
        collection.onDispose(() => {
            disposable.dispose();
            dispose.dispose();
            let idx = this.collections.findIndex(o => o == collection);
            if (idx !== -1)
                this.collections.splice(idx, 1);
            collection.forEach((uri, diagnostics) => {
                if (diagnostics && diagnostics.length)
                    this.refreshBuffer(uri);
            });
        });
        return collection;
    }
    /**
     * Get diagnostics ranges from document
     */
    getSortedRanges(uri) {
        let collections = this.getCollections(uri);
        let res = [];
        for (let collection of collections) {
            let ranges = collection.get(uri).map(o => o.range);
            res.push(...ranges);
        }
        res.sort((a, b) => {
            if (a.start.line != b.start.line) {
                return a.start.line - b.start.line;
            }
            return a.start.character - b.start.character;
        });
        return res;
    }
    /**
     * Get readonly diagnostics for a buffer
     */
    getDiagnostics(uri) {
        let collections = this.getCollections(uri);
        let { level } = this.config;
        let res = [];
        for (let collection of collections) {
            let items = collection.get(uri);
            if (!items)
                continue;
            if (level && level < vscode_languageserver_protocol_1.DiagnosticSeverity.Hint) {
                items = items.filter(s => s.severity == null || s.severity <= level);
            }
            res.push(...items);
        }
        res.sort((a, b) => {
            if (a.severity == b.severity) {
                let d = position_1.comparePosition(a.range.start, b.range.start);
                if (d != 0)
                    return d;
                if (a.source == b.source)
                    return a.message > b.message ? 1 : -1;
                return a.source > b.source ? 1 : -1;
            }
            return a.severity - b.severity;
        });
        return res;
    }
    getDiagnosticsInRange(document, range) {
        let collections = this.getCollections(document.uri);
        let res = [];
        for (let collection of collections) {
            let items = collection.get(document.uri);
            if (!items)
                continue;
            for (let item of items) {
                if (position_1.rangeIntersect(item.range, range)) {
                    res.push(item);
                }
            }
        }
        return res;
    }
    /**
     * Jump to previouse diagnostic position
     */
    async jumpPrevious() {
        let buffer = await this.nvim.buffer;
        let document = workspace_1.default.getDocument(buffer.id);
        if (!document)
            return;
        let offset = await workspace_1.default.getOffset();
        if (offset == null)
            return;
        let ranges = this.getSortedRanges(document.uri);
        if (ranges.length == 0) {
            workspace_1.default.showMessage('Empty diagnostics', 'warning');
            return;
        }
        let { textDocument } = document;
        for (let i = ranges.length - 1; i >= 0; i--) {
            if (textDocument.offsetAt(ranges[i].end) < offset) {
                await this.jumpTo(ranges[i]);
                return;
            }
        }
        await this.jumpTo(ranges[ranges.length - 1]);
    }
    /**
     * Jump to next diagnostic position
     */
    async jumpNext() {
        let buffer = await this.nvim.buffer;
        let document = workspace_1.default.getDocument(buffer.id);
        let offset = await workspace_1.default.getOffset();
        let ranges = this.getSortedRanges(document.uri);
        if (ranges.length == 0) {
            workspace_1.default.showMessage('Empty diagnostics', 'warning');
            return;
        }
        let { textDocument } = document;
        for (let i = 0; i <= ranges.length - 1; i++) {
            if (textDocument.offsetAt(ranges[i].start) > offset) {
                await this.jumpTo(ranges[i]);
                return;
            }
        }
        await this.jumpTo(ranges[0]);
    }
    /**
     * All diagnostics of current workspace
     */
    getDiagnosticList() {
        let res = [];
        for (let collection of this.collections) {
            collection.forEach((uri, diagnostics) => {
                let file = vscode_uri_1.URI.parse(uri).fsPath;
                for (let diagnostic of diagnostics) {
                    let { start } = diagnostic.range;
                    let o = {
                        file,
                        lnum: start.line + 1,
                        col: start.character + 1,
                        message: `[${diagnostic.source || collection.name}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${diagnostic.message}`,
                        severity: util_2.getSeverityName(diagnostic.severity),
                        level: diagnostic.severity || 0,
                        location: vscode_languageserver_protocol_1.Location.create(uri, diagnostic.range)
                    };
                    res.push(o);
                }
            });
        }
        res.sort((a, b) => {
            if (a.level !== b.level) {
                return a.level - b.level;
            }
            if (a.file !== b.file) {
                return a.file > b.file ? 1 : -1;
            }
            else {
                if (a.lnum != b.lnum) {
                    return a.lnum - b.lnum;
                }
                return a.col - b.col;
            }
        });
        return res;
    }
    /**
     * Echo diagnostic message of currrent position
     */
    async echoMessage(truncate = false) {
        if (!this.enabled || this.config.enableMessage == 'never')
            return;
        if (this.timer)
            clearTimeout(this.timer);
        let buf = await this.nvim.buffer;
        let pos = await workspace_1.default.getCursorPosition();
        let buffer = this.buffers.find(o => o.bufnr == buf.id);
        if (!buffer)
            return;
        let { checkCurrentLine } = this.config;
        let useFloat = this.config.messageTarget == 'float';
        let diagnostics = buffer.diagnostics.filter(o => {
            if (checkCurrentLine)
                return position_1.lineInRange(pos.line, o.range);
            return position_1.positionInRange(pos, o.range) == 0;
        });
        if (diagnostics.length == 0) {
            if (useFloat) {
                this.floatFactory.close();
            }
            else {
                let echoLine = await this.nvim.call('coc#util#echo_line');
                if (this.lastMessage && this.lastMessage == echoLine.trim()) {
                    this.nvim.command('echo ""', true);
                }
                this.lastMessage = '';
            }
            return;
        }
        if (truncate && workspace_1.default.insertMode)
            return;
        let lines = [];
        let docs = [];
        diagnostics.forEach(diagnostic => {
            let { source, code, severity, message } = diagnostic;
            let s = util_2.getSeverityName(severity)[0];
            let str = `[${source}${code ? ' ' + code : ''}] [${s}] ${message}`;
            let filetype = 'Error';
            switch (diagnostic.severity) {
                case vscode_languageserver_protocol_1.DiagnosticSeverity.Hint:
                    filetype = 'Hint';
                    break;
                case vscode_languageserver_protocol_1.DiagnosticSeverity.Warning:
                    filetype = 'Warning';
                    break;
                case vscode_languageserver_protocol_1.DiagnosticSeverity.Information:
                    filetype = 'Info';
                    break;
            }
            docs.push({ filetype, content: str });
            lines.push(...str.split('\n'));
        });
        if (useFloat) {
            await this.floatFactory.create(docs);
        }
        else {
            this.lastMessage = lines[0];
            await this.nvim.command('echo ""');
            await workspace_1.default.echoLines(lines, truncate);
        }
    }
    hideFloat() {
        if (this.floatFactory) {
            this.floatFactory.close();
        }
    }
    dispose() {
        for (let collection of this.collections) {
            collection.dispose();
        }
        this.buffers.splice(0, this.buffers.length);
        this.collections = [];
        this.floatFactory.dispose();
        util_1.disposeAll(this.disposables);
    }
    get nvim() {
        return workspace_1.default.nvim;
    }
    setConfiguration(event) {
        if (event && !event.affectsConfiguration('diagnostic'))
            return;
        let preferences = workspace_1.default.getConfiguration('coc.preferences.diagnostic');
        let config = workspace_1.default.getConfiguration('diagnostic');
        function getConfig(key, defaultValue) {
            return preferences.get(key, config.get(key, defaultValue));
        }
        let messageTarget = getConfig('messageTarget', 'float');
        if (messageTarget == 'float' && !workspace_1.default.env.floating && !workspace_1.default.env.textprop) {
            messageTarget = 'echo';
        }
        this.config = {
            messageTarget,
            srcId: workspace_1.default.createNameSpace('coc-diagnostic') || 1000,
            virtualTextSrcId: workspace_1.default.createNameSpace('diagnostic-virtualText'),
            checkCurrentLine: getConfig('checkCurrentLine', false),
            enableSign: getConfig('enableSign', true),
            maxWindowHeight: getConfig('maxWindowHeight', 10),
            enableMessage: getConfig('enableMessage', 'always'),
            joinMessageLines: getConfig('joinMessageLines', false),
            virtualText: getConfig('virtualText', false),
            virtualTextPrefix: getConfig('virtualTextPrefix', " "),
            virtualTextLineSeparator: getConfig('virtualTextLineSeparator', " \\ "),
            virtualTextLines: getConfig('virtualTextLines', 3),
            displayByAle: getConfig('displayByAle', false),
            level: util_2.severityLevel(getConfig('level', 'hint')),
            locationlist: getConfig('locationlist', true),
            signOffset: getConfig('signOffset', 1000),
            errorSign: getConfig('errorSign', '>>'),
            warningSign: getConfig('warningSign', '>>'),
            infoSign: getConfig('infoSign', '>>'),
            hintSign: getConfig('hintSign', '>>'),
            refreshAfterSave: getConfig('refreshAfterSave', false),
            refreshOnInsertMode: getConfig('refreshOnInsertMode', false),
        };
        this.enabled = getConfig('enable', true);
        if (this.config.displayByAle) {
            this.enabled = false;
        }
        if (event) {
            for (let severity of ['error', 'info', 'warning', 'hint']) {
                let key = `diagnostic.${severity}Sign`;
                if (event.affectsConfiguration(key)) {
                    let text = config.get(`${severity}Sign`, '>>');
                    let name = severity[0].toUpperCase() + severity.slice(1);
                    this.nvim.command(`sign define Coc${name}   text=${text}   linehl=Coc${name}Line texthl=Coc${name}Sign`, true);
                }
            }
        }
    }
    getCollections(uri) {
        return this.collections.filter(c => c.has(uri));
    }
    shouldValidate(doc) {
        return doc != null && doc.buftype == '';
    }
    refreshBuffer(uri) {
        // vim has issue with diagnostic update
        if (workspace_1.default.insertMode && !this.config.refreshOnInsertMode)
            return;
        let buf = this.buffers.find(buf => buf.uri == uri);
        let { displayByAle } = this.config;
        if (buf) {
            if (displayByAle) {
                let { nvim } = this;
                let allDiagnostics = new Map();
                for (let collection of this.collections) {
                    let diagnostics = collection.get(uri);
                    let aleItems = diagnostics.map(o => {
                        let { range } = o;
                        return {
                            text: o.message,
                            code: o.code,
                            lnum: range.start.line + 1,
                            col: range.start.character + 1,
                            end_lnum: range.end.line + 1,
                            end_col: range.end.character,
                            type: util_2.getSeverityType(o.severity)
                        };
                    });
                    let exists = allDiagnostics.get(collection.name);
                    if (exists) {
                        exists.push(...aleItems);
                    }
                    else {
                        allDiagnostics.set(collection.name, aleItems);
                    }
                }
                nvim.pauseNotification();
                for (let key of allDiagnostics.keys()) {
                    this.nvim.call('ale#other_source#ShowResults', [buf.bufnr, key, allDiagnostics.get(key)], true);
                }
                nvim.resumeNotification(false, true).catch(_e => {
                    // noop
                });
            }
            else {
                let diagnostics = this.getDiagnostics(uri);
                if (this.enabled) {
                    buf.refresh(diagnostics);
                    return true;
                }
            }
        }
        return false;
    }
    async jumpTo(range) {
        if (!range)
            return;
        let { start } = range;
        await this.nvim.call('cursor', [start.line + 1, start.character + 1]);
        await this.echoMessage();
    }
}
exports.DiagnosticManager = DiagnosticManager;
exports.default = new DiagnosticManager();
//# sourceMappingURL=manager.js.map