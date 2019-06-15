"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const commands_1 = tslib_1.__importDefault(require("../commands"));
const events_1 = tslib_1.__importDefault(require("../events"));
const languages_1 = tslib_1.__importDefault(require("../languages"));
const services_1 = tslib_1.__importDefault(require("../services"));
const util_1 = require("../util");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('codelens');
class CodeLensManager {
    constructor(nvim) {
        this.nvim = nvim;
        this.fetching = new Set();
        this.disposables = [];
        this.codeLensMap = new Map();
        this.init().catch(e => {
            logger.error(e.message);
        });
    }
    async init() {
        this.setConfiguration();
        if (!this.enabled)
            return;
        this.srcId = workspace_1.default.createNameSpace('coc-codelens') || 1080;
        services_1.default.on('ready', async (id) => {
            let service = services_1.default.getService(id);
            let doc = workspace_1.default.getDocument(workspace_1.default.bufnr);
            if (!doc)
                return;
            if (workspace_1.default.match(service.selector, doc.textDocument)) {
                this.resolveCodeLens.clear();
                await util_1.wait(2000);
                await this.fetchDocumentCodeLenes();
            }
        });
        let timer;
        workspace_1.default.onDidChangeTextDocument(async (e) => {
            let doc = workspace_1.default.getDocument(e.textDocument.uri);
            if (doc && doc.bufnr == workspace_1.default.bufnr) {
                if (timer)
                    clearTimeout(timer);
                setTimeout(async () => {
                    await this.fetchDocumentCodeLenes();
                }, 100);
            }
        }, null, this.disposables);
        workspace_1.default.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('codelens')) {
                this.setConfiguration();
            }
        }, null, this.disposables);
        events_1.default.on(['TextChanged', 'TextChangedI'], async () => {
            this.resolveCodeLens.clear();
        }, null, this.disposables);
        events_1.default.on('CursorMoved', () => {
            this.resolveCodeLens();
        }, null, this.disposables);
        events_1.default.on('BufUnload', bufnr => {
            let buf = this.nvim.createBuffer(bufnr);
            if (this.nvim.hasFunction('nvim_create_namespace')) {
                buf.clearNamespace(this.srcId);
            }
            else {
                buf.clearHighlight({ srcId: this.srcId });
            }
        }, null, this.disposables);
        events_1.default.on('BufEnter', bufnr => {
            setTimeout(async () => {
                if (workspace_1.default.bufnr == bufnr) {
                    await this.fetchDocumentCodeLenes();
                }
            }, 100);
        }, null, this.disposables);
        events_1.default.on('InsertLeave', async () => {
            let { bufnr } = workspace_1.default;
            let info = this.codeLensMap.get(bufnr);
            if (info && info.version != this.version) {
                this.resolveCodeLens.clear();
                await util_1.wait(50);
                await this.fetchDocumentCodeLenes();
            }
        }, null, this.disposables);
        this.resolveCodeLens = debounce_1.default(() => {
            this._resolveCodeLenes().catch(e => {
                logger.error(e);
            });
        }, 200);
    }
    setConfiguration() {
        let { nvim } = this;
        let config = workspace_1.default.getConfiguration('coc.preferences.codeLens');
        if (Object.keys(config).length == 0) {
            config = workspace_1.default.getConfiguration('codeLens');
        }
        this.separator = config.get('separator', '‣');
        this.enabled = nvim.hasFunction('nvim_buf_set_virtual_text') && config.get('enable', true);
    }
    async fetchDocumentCodeLenes(retry = 0) {
        let doc = workspace_1.default.getDocument(workspace_1.default.bufnr);
        if (!doc)
            return;
        let { uri, version, bufnr } = doc;
        let document = workspace_1.default.getDocument(uri);
        if (!this.validDocument(document))
            return;
        if (this.fetching.has(bufnr))
            return;
        this.fetching.add(bufnr);
        try {
            let codeLenes = await languages_1.default.getCodeLens(document.textDocument);
            if (codeLenes && codeLenes.length > 0) {
                this.codeLensMap.set(document.bufnr, { codeLenes, version });
                if (workspace_1.default.bufnr == document.bufnr) {
                    this.resolveCodeLens.clear();
                    await this._resolveCodeLenes(true);
                }
            }
            this.fetching.delete(bufnr);
        }
        catch (e) {
            this.fetching.delete(bufnr);
            logger.error(e);
            if (/timeout/.test(e.message) && retry < 5) {
                this.fetchDocumentCodeLenes(retry + 1); // tslint:disable-line
            }
        }
    }
    async setVirtualText(buffer, codeLenes) {
        let list = new Map();
        for (let codeLens of codeLenes) {
            let { range, command } = codeLens;
            if (!command)
                continue;
            let { line } = range.start;
            if (list.has(line)) {
                list.get(line).push(codeLens);
            }
            else {
                list.set(line, [codeLens]);
            }
        }
        for (let lnum of list.keys()) {
            let codeLenes = list.get(lnum);
            let commands = codeLenes.map(codeLens => codeLens.command);
            commands = commands.filter(c => c && c.title);
            let chunks = commands.map(c => [c.title + ' ', 'CocCodeLens']);
            chunks.unshift([`${this.separator} `, 'CocCodeLens']);
            await buffer.setVirtualText(this.srcId, lnum, chunks);
        }
    }
    async _resolveCodeLenes(clear = false) {
        let { nvim } = this;
        let { bufnr } = workspace_1.default;
        let { codeLenes, version } = this.codeLensMap.get(bufnr) || {};
        if (workspace_1.default.insertMode)
            return;
        if (codeLenes && codeLenes.length) {
            // resolve codeLens of current window
            let start = await nvim.call('line', 'w0');
            let end = await nvim.call('line', 'w$');
            if (version && this.version != version)
                return;
            if (end >= start) {
                codeLenes = codeLenes.filter(o => {
                    let lnum = o.range.start.line + 1;
                    return lnum >= start && lnum <= end;
                });
                if (codeLenes.length) {
                    await Promise.all(codeLenes.map(codeLens => {
                        return languages_1.default.resolveCodeLens(codeLens);
                    }));
                }
            }
            else {
                codeLenes = null;
            }
        }
        nvim.pauseNotification();
        let doc = workspace_1.default.getDocument(bufnr);
        if (doc && clear) {
            doc.clearMatchIds([this.srcId]);
        }
        if (codeLenes && codeLenes.length)
            await this.setVirtualText(doc.buffer, codeLenes);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
    async doAction() {
        let { nvim } = this;
        let bufnr = await nvim.call('bufnr', '%');
        let line = await nvim.call('line', '.') - 1;
        let { codeLenes } = this.codeLensMap.get(bufnr);
        if (!codeLenes || codeLenes.length == 0) {
            workspace_1.default.showMessage('No codeLenes available', 'warning');
            return;
        }
        let list = new Map();
        for (let codeLens of codeLenes) {
            let { range, command } = codeLens;
            if (!command)
                continue;
            let { line } = range.start;
            if (list.has(line)) {
                list.get(line).push(codeLens);
            }
            else {
                list.set(line, [codeLens]);
            }
        }
        let current = null;
        for (let i = line; i >= 0; i--) {
            if (list.has(i)) {
                current = list.get(i);
                break;
            }
        }
        if (!current) {
            workspace_1.default.showMessage('No codeLenes available', 'warning');
            return;
        }
        let commands = current.map(o => o.command);
        commands = commands.filter(c => c.command != null && c.command != '');
        if (commands.length == 0) {
            workspace_1.default.showMessage('CodeLenes command not found', 'warning');
        }
        else if (commands.length == 1) {
            commands_1.default.execute(commands[0]);
        }
        else {
            let res = await workspace_1.default.showQuickpick(commands.map(c => c.title));
            if (res == -1)
                return;
            commands_1.default.execute(commands[res]);
        }
    }
    validDocument(doc) {
        if (!doc)
            return false;
        if (doc.schema != 'file' || doc.buftype != '')
            return false;
        return true;
    }
    get version() {
        let doc = workspace_1.default.getDocument(workspace_1.default.bufnr);
        return doc ? doc.version : 0;
    }
    dispose() {
        if (this.resolveCodeLens) {
            this.resolveCodeLens.clear();
        }
        util_1.disposeAll(this.disposables);
    }
}
exports.default = CodeLensManager;
//# sourceMappingURL=codelens.js.map