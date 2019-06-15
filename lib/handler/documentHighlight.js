"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = tslib_1.__importDefault(require("../events"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const languages_1 = tslib_1.__importDefault(require("../languages"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const util_1 = require("../util");
const logger = require('../util/logger')('documentHighlight');
class DocumentHighlighter {
    constructor(nvim, colors) {
        this.nvim = nvim;
        this.colors = colors;
        this.disposables = [];
        this.matchIds = new Set();
        events_1.default.on('BufWinLeave', () => {
            this.clearHighlight();
        }, null, this.disposables);
        events_1.default.on(['CursorMoved', 'CursorMovedI'], () => {
            this.cursorMoveTs = Date.now();
        }, null, this.disposables);
        events_1.default.on('InsertEnter', () => {
            this.clearHighlight();
        }, null, this.disposables);
    }
    // clear matchIds of current window
    clearHighlight() {
        let { matchIds } = this;
        let { nvim } = workspace_1.default;
        if (matchIds.size == 0)
            return;
        nvim.call('coc#util#clearmatches', [Array.from(matchIds)], true);
        this.matchIds.clear();
    }
    async highlight(bufnr) {
        let { nvim } = this;
        let document = workspace_1.default.getDocument(bufnr);
        let highlights = await this.getHighlights(document);
        if (!highlights || highlights.length == 0) {
            this.clearHighlight();
            return;
        }
        if (workspace_1.default.bufnr != bufnr)
            return;
        nvim.pauseNotification();
        this.clearHighlight();
        let groups = {};
        for (let hl of highlights) {
            let hlGroup = hl.kind == vscode_languageserver_protocol_1.DocumentHighlightKind.Text
                ? 'CocHighlightText'
                : hl.kind == vscode_languageserver_protocol_1.DocumentHighlightKind.Read ? 'CocHighlightRead' : 'CocHighlightWrite';
            groups[hlGroup] = groups[hlGroup] || [];
            groups[hlGroup].push(hl.range);
        }
        for (let hlGroup of Object.keys(groups)) {
            let ids = document.matchAddRanges(groups[hlGroup], hlGroup, -1);
            for (let id of ids) {
                this.matchIds.add(id);
            }
        }
        this.nvim.call('coc#util#add_matchids', [Array.from(this.matchIds)], true);
        await this.nvim.resumeNotification(false, true);
    }
    async getHighlights(document) {
        if (!document)
            return null;
        let ts = Date.now();
        let { bufnr } = document;
        let position = await workspace_1.default.getCursorPosition();
        let line = document.getline(position.line);
        let ch = line[position.character];
        if (!ch || !document.isWord(ch) || this.colors.hasColorAtPostion(bufnr, position)) {
            return null;
        }
        let highlights = await languages_1.default.getDocumentHighLight(document.textDocument, position);
        if (workspace_1.default.bufnr != document.bufnr || (this.cursorMoveTs && this.cursorMoveTs > ts)) {
            return null;
        }
        return highlights;
    }
    dispose() {
        util_1.disposeAll(this.disposables);
    }
}
exports.default = DocumentHighlighter;
//# sourceMappingURL=documentHighlight.js.map