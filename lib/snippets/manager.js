"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = tslib_1.__importDefault(require("../events"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const Snippets = tslib_1.__importStar(require("./parser"));
const parser_1 = require("./parser");
const session_1 = require("./session");
const variableResolve_1 = require("./variableResolve");
const logger = require('../util/logger')('snippets-manager');
class SnippetManager {
    constructor() {
        this.sessionMap = new Map();
        this.disposables = [];
        // tslint:disable-next-line:no-floating-promises
        workspace_1.default.ready.then(() => {
            let config = workspace_1.default.getConfiguration('coc.preferences');
            this.statusItem = workspace_1.default.createStatusBarItem(0);
            this.statusItem.text = config.get('snippetStatusText', 'SNIP');
        });
        workspace_1.default.onDidChangeTextDocument(async (e) => {
            let { uri } = e.textDocument;
            let doc = workspace_1.default.getDocument(uri);
            if (!doc)
                return;
            let session = this.getSession(doc.bufnr);
            if (session && session.isActive) {
                await session.synchronizeUpdatedPlaceholders(e.contentChanges[0]);
            }
        }, null, this.disposables);
        workspace_1.default.onDidCloseTextDocument(textDocument => {
            let doc = workspace_1.default.getDocument(textDocument.uri);
            if (!doc)
                return;
            let session = this.getSession(doc.bufnr);
            if (session)
                session.deactivate();
        }, null, this.disposables);
        events_1.default.on('BufEnter', async (bufnr) => {
            let session = this.getSession(bufnr);
            if (!this.statusItem)
                return;
            if (session && session.isActive) {
                this.statusItem.show();
            }
            else {
                this.statusItem.hide();
            }
        }, null, this.disposables);
        events_1.default.on('InsertEnter', async () => {
            let { session } = this;
            if (!session)
                return;
            await session.checkPosition();
        }, null, this.disposables);
    }
    /**
     * Insert snippet at current cursor position
     */
    async insertSnippet(snippet, select = true, range) {
        let { nvim } = workspace_1.default;
        let bufnr = await nvim.call('bufnr', '%');
        let session = this.getSession(bufnr);
        if (!session) {
            session = new session_1.SnippetSession(workspace_1.default.nvim, bufnr);
            this.sessionMap.set(bufnr, session);
            session.onCancel(() => {
                this.sessionMap.delete(bufnr);
                if (workspace_1.default.bufnr == bufnr) {
                    this.statusItem.hide();
                }
            });
        }
        let isActive = await session.start(snippet, select, range);
        if (isActive) {
            this.statusItem.show();
        }
        else if (session) {
            session.deactivate();
        }
        nvim.command('silent! unlet g:coc_last_placeholder g:coc_selected_text', true);
        return isActive;
    }
    isPlainText(text) {
        let snippet = (new parser_1.SnippetParser()).parse(text, true);
        if (snippet.placeholders.every(p => p.isFinalTabstop == true && p.toString() == '')) {
            return true;
        }
        return false;
    }
    async selectCurrentPlaceholder(triggerAutocmd = true) {
        let { session } = this;
        if (session)
            return await session.selectCurrentPlaceholder(triggerAutocmd);
    }
    async nextPlaceholder() {
        let { session } = this;
        if (session)
            return await session.nextPlaceholder();
        workspace_1.default.nvim.call('coc#snippet#disable', [], true);
        this.statusItem.hide();
    }
    async previousPlaceholder() {
        let { session } = this;
        if (session)
            return await session.previousPlaceholder();
        workspace_1.default.nvim.call('coc#snippet#disable', [], true);
        this.statusItem.hide();
    }
    cancel() {
        let session = this.getSession(workspace_1.default.bufnr);
        if (session)
            return session.deactivate();
        workspace_1.default.nvim.call('coc#snippet#disable', [], true);
        if (this.statusItem)
            this.statusItem.hide();
    }
    get session() {
        let session = this.getSession(workspace_1.default.bufnr);
        return session && session.isActive ? session : null;
    }
    isActived(bufnr) {
        let session = this.getSession(bufnr);
        return session && session.isActive;
    }
    jumpable() {
        let { session } = this;
        if (!session)
            return false;
        let placeholder = session.placeholder;
        if (placeholder && !placeholder.isFinalTabstop) {
            return true;
        }
        return false;
    }
    getSession(bufnr) {
        return this.sessionMap.get(bufnr);
    }
    async resolveSnippet(body) {
        let parser = new Snippets.SnippetParser();
        const snippet = parser.parse(body, true);
        const resolver = new variableResolve_1.SnippetVariableResolver();
        snippet.resolveVariables(resolver);
        return snippet;
    }
    dispose() {
        this.cancel();
        for (let d of this.disposables) {
            d.dispose();
        }
    }
}
exports.SnippetManager = SnippetManager;
exports.default = new SnippetManager();
//# sourceMappingURL=manager.js.map