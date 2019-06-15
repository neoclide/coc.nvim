"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const callSequence_1 = tslib_1.__importDefault(require("../util/callSequence"));
const object_1 = require("../util/object");
const string_1 = require("../util/string");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const util_1 = require("./util");
const logger = require('../util/logger')('diagnostic-buffer');
const severityNames = ['CocError', 'CocWarning', 'CocInfo', 'CocHint'];
const STARTMATCHID = 1090;
// maintains sign and highlightId
class DiagnosticBuffer {
    constructor(doc, config) {
        this.config = config;
        this.matchIds = new Set();
        this.signIds = new Set();
        this.sequence = null;
        this.matchId = STARTMATCHID;
        this._onDidRefresh = new vscode_languageserver_protocol_1.Emitter();
        this.diagnostics = [];
        this.onDidRefresh = this._onDidRefresh.event;
        this.bufnr = doc.bufnr;
        this.uri = doc.uri;
        let timer = null;
        let time = Date.now();
        this.refresh = (diagnostics) => {
            time = Date.now();
            if (timer)
                clearTimeout(timer);
            timer = setTimeout(async () => {
                let current = time;
                if (this.sequence) {
                    await this.sequence.cancel();
                }
                // staled
                if (current != time)
                    return;
                this._refresh(diagnostics);
            }, global.hasOwnProperty('__TEST__') ? 30 : 50);
        };
    }
    get nvim() {
        return workspace_1.default.nvim;
    }
    _refresh(diagnostics) {
        if (object_1.equals(this.diagnostics, diagnostics))
            return;
        let sequence = this.sequence = new callSequence_1.default();
        let winid;
        sequence.addFunction(async () => {
            let valid = await this.nvim.call('coc#util#valid_state');
            return valid ? false : true;
        });
        sequence.addFunction(async () => {
            let { nvim, bufnr } = this;
            winid = await nvim.call('bufwinid', bufnr);
        });
        sequence.addFunction(async () => {
            this.nvim.pauseNotification();
            this.setDiagnosticInfo(diagnostics);
            this.addDiagnosticVText(diagnostics);
            this.setLocationlist(diagnostics, winid);
            this.addSigns(diagnostics);
            this.addHighlight(diagnostics, winid);
            await this.nvim.resumeNotification();
        });
        sequence.start().then(async (canceled) => {
            if (!canceled) {
                this.diagnostics = diagnostics;
                this._onDidRefresh.fire(void 0);
            }
        }, e => {
            logger.error(e);
        });
    }
    setLocationlist(diagnostics, winid) {
        if (!this.config.locationlist)
            return;
        let { nvim, bufnr } = this;
        // not shown
        if (winid == -1)
            return;
        let items = [];
        for (let diagnostic of diagnostics) {
            let item = util_1.getLocationListItem(diagnostic.source, bufnr, diagnostic);
            items.push(item);
        }
        nvim.call('setloclist', [winid, [], ' ', { title: 'Diagnostics of coc', items }], true);
    }
    clearSigns() {
        let { nvim, signIds, bufnr } = this;
        if (signIds.size > 0) {
            nvim.call('coc#util#unplace_signs', [bufnr, Array.from(signIds)], true);
            signIds.clear();
        }
    }
    async checkSigns() {
        let { nvim, bufnr, signIds } = this;
        try {
            let content = await this.nvim.call('execute', [`sign place buffer=${bufnr}`]);
            let lines = content.split('\n');
            let ids = [];
            for (let line of lines) {
                let ms = line.match(/^\s*line=\d+\s+id=(\d+)\s+name=(\w+)/);
                if (!ms)
                    continue;
                let [, id, name] = ms;
                if (!signIds.has(Number(id)) && severityNames.indexOf(name) != -1) {
                    ids.push(id);
                }
            }
            await nvim.call('coc#util#unplace_signs', [bufnr, ids]);
        }
        catch (e) {
            // noop
        }
    }
    addSigns(diagnostics) {
        if (!this.config.enableSign)
            return;
        this.clearSigns();
        let { nvim, bufnr, signIds } = this;
        let signId = this.config.signOffset;
        signIds.clear();
        let lines = new Set();
        for (let diagnostic of diagnostics) {
            let { range, severity } = diagnostic;
            let line = range.start.line;
            if (lines.has(line))
                continue;
            lines.add(line);
            let name = util_1.getNameFromSeverity(severity);
            nvim.command(`sign place ${signId} line=${line + 1} name=${name} buffer=${bufnr}`, true);
            signIds.add(signId);
            signId = signId + 1;
        }
    }
    setDiagnosticInfo(diagnostics) {
        let info = { error: 0, warning: 0, information: 0, hint: 0 };
        for (let diagnostic of diagnostics) {
            switch (diagnostic.severity) {
                case vscode_languageserver_protocol_1.DiagnosticSeverity.Warning:
                    info.warning = info.warning + 1;
                    break;
                case vscode_languageserver_protocol_1.DiagnosticSeverity.Information:
                    info.information = info.information + 1;
                    break;
                case vscode_languageserver_protocol_1.DiagnosticSeverity.Hint:
                    info.hint = info.hint + 1;
                    break;
                default:
                    info.error = info.error + 1;
            }
        }
        let buffer = this.nvim.createBuffer(this.bufnr);
        buffer.setVar('coc_diagnostic_info', info, true);
        if (!workspace_1.default.getDocument(this.bufnr))
            return;
        if (workspace_1.default.bufnr == this.bufnr)
            this.nvim.command('redraws', true);
        this.nvim.command('silent doautocmd User CocDiagnosticChange', true);
    }
    addDiagnosticVText(diagnostics) {
        let { bufnr, nvim } = this;
        if (!this.config.virtualText)
            return;
        if (!nvim.hasFunction('nvim_buf_set_virtual_text'))
            return;
        let buffer = this.nvim.createBuffer(bufnr);
        let lines = new Set();
        let srcId = this.config.virtualTextSrcId;
        let prefix = this.config.virtualTextPrefix;
        buffer.clearNamespace(srcId);
        for (let diagnostic of diagnostics) {
            let { line } = diagnostic.range.start;
            if (lines.has(line))
                continue;
            lines.add(line);
            let highlight = util_1.getNameFromSeverity(diagnostic.severity) + 'VirtualText';
            let msg = diagnostic.message.split(/\n/)
                .map((l) => l.trim())
                .filter((l) => l.length > 0)
                .slice(0, this.config.virtualTextLines)
                .join(this.config.virtualTextLineSeparator);
            buffer.setVirtualText(srcId, line, [[prefix + msg, highlight]], {}).catch(_e => {
                // noop
            });
        }
    }
    clearHighlight() {
        let { bufnr, nvim, matchIds } = this;
        if (workspace_1.default.isVim) {
            nvim.call('coc#util#clearmatches', [Array.from(matchIds)], true);
            this.matchId = STARTMATCHID;
        }
        else {
            let buffer = nvim.createBuffer(bufnr);
            if (this.nvim.hasFunction('nvim_create_namespace')) {
                buffer.clearNamespace(this.config.srcId);
            }
            else {
                buffer.clearHighlight({ srcId: this.config.srcId });
            }
        }
        this.matchIds.clear();
    }
    addHighlight(diagnostics, winid) {
        this.clearHighlight();
        if (diagnostics.length == 0)
            return;
        if (winid == -1 && workspace_1.default.isVim)
            return;
        for (let diagnostic of diagnostics.slice().reverse()) {
            let { range, severity } = diagnostic;
            if (workspace_1.default.isVim) {
                this.addHighlightVim(winid, range, severity);
            }
            else {
                this.addHighlightNvim(range, severity);
            }
        }
    }
    addHighlightNvim(range, severity) {
        let { srcId } = this.config;
        let { start, end } = range;
        let document = workspace_1.default.getDocument(this.bufnr);
        if (!document)
            return;
        let { buffer } = document;
        for (let i = start.line; i <= end.line; i++) {
            let line = document.getline(i);
            if (!line || !line.length)
                continue;
            let s = i == start.line ? start.character : 0;
            let e = i == end.line ? end.character : -1;
            buffer.addHighlight({
                srcId,
                hlGroup: util_1.getNameFromSeverity(severity) + 'Highlight',
                line: i,
                colStart: s == 0 ? 0 : string_1.byteIndex(line, s),
                colEnd: e == -1 ? -1 : string_1.byteIndex(line, e),
            }).catch(_e => {
                // noop
            });
        }
        this.matchIds.add(srcId);
    }
    addHighlightVim(winid, range, severity) {
        let { start, end } = range;
        let { matchIds } = this;
        let document = workspace_1.default.getDocument(this.bufnr);
        if (!document)
            return;
        try {
            let list = [];
            for (let i = start.line; i <= end.line; i++) {
                let line = document.getline(i);
                if (!line || !line.length)
                    continue;
                if (list.length == 8)
                    break;
                if (i == start.line && i == end.line) {
                    let s = string_1.byteIndex(line, start.character) + 1;
                    let e = string_1.byteIndex(line, end.character) + 1;
                    list.push([i + 1, s, e - s]);
                }
                else if (i == start.line) {
                    let s = string_1.byteIndex(line, start.character) + 1;
                    let l = string_1.byteLength(line);
                    list.push([i + 1, s, l - s + 1]);
                }
                else if (i == end.line) {
                    let e = string_1.byteIndex(line, end.character) + 1;
                    list.push([i + 1, 0, e]);
                }
                else {
                    list.push(i + 1);
                }
            }
            this.nvim.callTimer('matchaddpos', [util_1.getNameFromSeverity(severity) + 'highlight', list, 99, this.matchId, { window: winid }], true);
            matchIds.add(this.matchId);
            this.matchId = this.matchId + 1;
        }
        catch (e) {
            logger.error(e.stack);
        }
    }
    /**
     * Used on buffer unload
     *
     * @public
     * @returns {Promise<void>}
     */
    async clear() {
        if (this.sequence)
            await this.sequence.cancel();
        this.setDiagnosticInfo([]);
        this.clearHighlight();
        this.clearSigns();
        // clear locationlist
        if (this.config.locationlist) {
            let winid = await this.nvim.call('bufwinid', this.bufnr);
            // not shown
            if (winid == -1)
                return;
            let curr = await this.nvim.call('getloclist', [winid, { title: 1 }]);
            if ((curr.title && curr.title.indexOf('Diagnostics of coc') != -1)) {
                this.nvim.call('setloclist', [winid, [], 'f'], true);
            }
        }
        if (this.config.virtualText) {
            let buffer = this.nvim.createBuffer(this.bufnr);
            buffer.clearNamespace(this.config.virtualTextSrcId);
        }
        this.nvim.command('silent doautocmd User CocDiagnosticChange', true);
    }
    hasMatch(match) {
        return this.matchIds.has(match);
    }
    dispose() {
        if (this.sequence) {
            this.sequence.cancel().catch(_e => {
                // noop
            });
        }
        this._onDidRefresh.dispose();
    }
}
exports.DiagnosticBuffer = DiagnosticBuffer;
//# sourceMappingURL=buffer.js.map