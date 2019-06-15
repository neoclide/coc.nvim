"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const readline_1 = tslib_1.__importDefault(require("readline"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const util_1 = require("../util");
const position_1 = require("../util/position");
const string_1 = require("../util/string");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const configuration_1 = tslib_1.__importDefault(require("./configuration"));
const logger = require('../util/logger')('list-basic');
class BasicList {
    constructor(nvim) {
        this.nvim = nvim;
        this.defaultAction = 'open';
        this.actions = [];
        this.options = [];
        this.disposables = [];
        this.config = new configuration_1.default();
    }
    get hlGroup() {
        return this.config.get('previewHighlightGroup', 'Search');
    }
    get previewHeight() {
        return this.config.get('maxPreviewHeight', 12);
    }
    get splitRight() {
        return this.config.get('previewSplitRight', false);
    }
    parseArguments(args) {
        if (!this.optionMap) {
            this.optionMap = new Map();
            for (let opt of this.options) {
                let parts = opt.name.split(/,\s*/g).map(s => s.replace(/\s+.*/g, ''));
                let name = opt.key ? opt.key : parts[parts.length - 1].replace(/^-/, '');
                for (let p of parts) {
                    this.optionMap.set(p, { name, hasValue: opt.hasValue });
                }
            }
        }
        let res = {};
        for (let i = 0; i < args.length; i++) {
            let arg = args[i];
            let def = this.optionMap.get(arg);
            if (!def) {
                logger.error(`Option "${arg}" of "${this.name}" not found`);
                continue;
            }
            let value = true;
            if (def.hasValue) {
                value = args[i + 1] || '';
                i = i + 1;
            }
            res[def.name] = value;
        }
        return res;
    }
    getConfig() {
        return workspace_1.default.getConfiguration(`list.source.${this.name}`);
    }
    addAction(name, fn, options) {
        this.createAction(Object.assign({
            name,
            execute: fn
        }, options || {}));
    }
    addMultipleAction(name, fn, options) {
        this.createAction(Object.assign({
            name,
            multiple: true,
            execute: fn
        }, options || {}));
    }
    addLocationActions() {
        this.createAction({
            name: 'preview',
            execute: async (item, context) => {
                let loc = await this.convertLocation(item.location);
                await this.previewLocation(loc, context);
            }
        });
        let { nvim } = this;
        this.createAction({
            name: 'quickfix',
            multiple: true,
            execute: async (items) => {
                let quickfixItems = await Promise.all(items.map(item => {
                    return this.convertLocation(item.location).then(loc => {
                        return workspace_1.default.getQuickfixItem(loc);
                    });
                }));
                await nvim.call('setqflist', [quickfixItems]);
                nvim.command('copen', true);
            }
        });
        for (let name of ['open', 'tabe', 'drop', 'vsplit', 'split']) {
            this.createAction({
                name,
                execute: async (item) => {
                    await this.jumpTo(item.location, name == 'open' ? null : name);
                }
            });
        }
    }
    async convertLocation(location) {
        if (typeof location == 'string')
            return vscode_languageserver_protocol_1.Location.create(location, vscode_languageserver_protocol_1.Range.create(0, 0, 0, 0));
        if (vscode_languageserver_protocol_1.Location.is(location))
            return location;
        let u = vscode_uri_1.URI.parse(location.uri);
        if (u.scheme != 'file')
            return vscode_languageserver_protocol_1.Location.create(location.uri, vscode_languageserver_protocol_1.Range.create(0, 0, 0, 0));
        const rl = readline_1.default.createInterface({
            input: fs_1.default.createReadStream(u.fsPath, { encoding: 'utf8' }),
        });
        let match = location.line;
        let n = 0;
        let resolved = false;
        let line = await new Promise(resolve => {
            rl.on('line', line => {
                if (resolved)
                    return;
                if (line.indexOf(match) !== -1) {
                    rl.removeAllListeners();
                    rl.close();
                    resolved = true;
                    resolve(line);
                    return;
                }
                n = n + 1;
            });
            rl.on('error', e => {
                this.nvim.errWriteLine(`Read ${u.fsPath} error: ${e.message}`);
                resolve(null);
            });
        });
        if (line != null) {
            let character = location.text ? line.indexOf(location.text) : 0;
            if (character == 0)
                character = line.match(/^\s*/)[0].length;
            let end = vscode_languageserver_protocol_1.Position.create(n, character + (location.text ? location.text.length : 0));
            return vscode_languageserver_protocol_1.Location.create(location.uri, vscode_languageserver_protocol_1.Range.create(vscode_languageserver_protocol_1.Position.create(n, character), end));
        }
        return vscode_languageserver_protocol_1.Location.create(location.uri, vscode_languageserver_protocol_1.Range.create(0, 0, 0, 0));
    }
    async jumpTo(location, command) {
        if (typeof location == 'string') {
            await workspace_1.default.jumpTo(location, null, command);
            return;
        }
        let { range, uri } = await this.convertLocation(location);
        let position = range.start;
        if (position.line == 0 && position.character == 0 && position_1.comparePosition(position, range.end) == 0) {
            // allow plugin that remember position.
            position = null;
        }
        await workspace_1.default.jumpTo(uri, position, command);
    }
    createAction(action) {
        let { name } = action;
        let idx = this.actions.findIndex(o => o.name == name);
        // allow override
        if (idx !== -1)
            this.actions.splice(idx, 1);
        this.actions.push(action);
    }
    async previewLocation(location, context) {
        let { nvim } = this;
        let { uri, range } = location;
        let lineCount = Infinity;
        let doc = workspace_1.default.getDocument(location.uri);
        if (doc)
            lineCount = doc.lineCount;
        let height = Math.min(this.previewHeight, lineCount);
        let u = vscode_uri_1.URI.parse(uri);
        if (u.scheme == 'untitled' || u.scheme == 'unknown') {
            let bufnr = parseInt(u.path, 10);
            let valid = await nvim.call('bufloaded', [bufnr]);
            let lnum = location.range.start.line + 1;
            if (valid) {
                let name = await nvim.call('bufname', [bufnr]);
                name = name || '[No Name]';
                let filetype = await nvim.call('getbufvar', [bufnr, '&filetype']);
                let lines = await nvim.call('getbufline', [bufnr, 1, '$']);
                await this.preview({ bufname: name, sketch: true, filetype: filetype || 'txt', lnum, lines }, context);
            }
            else {
                await this.preview({ bufname: '[No Name]', sketch: true, filetype: 'txt', lines: [] }, context);
            }
            return;
        }
        let filepath = u.scheme == 'file' ? u.fsPath : u.toString();
        let escaped = await nvim.call('fnameescape', filepath);
        let lnum = range.start.line + 1;
        let mod = context.options.position == 'top' ? 'below' : 'above';
        let winid = context.listWindow.id;
        let exists = await nvim.call('bufloaded', filepath);
        let valid = await context.window.valid;
        nvim.pauseNotification();
        nvim.command('pclose', true);
        if (this.splitRight) {
            if (valid)
                nvim.call('win_gotoid', [context.window.id], true);
            nvim.command(`silent belowright vs +setl\\ previewwindow ${escaped}`, true);
        }
        else {
            nvim.command(`silent ${mod} ${height}sp +setl\\ previewwindow ${escaped}`, true);
        }
        nvim.command(`exe ${lnum}`, true);
        nvim.command('setl winfixheight nofoldenable', true);
        if (position_1.comparePosition(range.start, range.end) !== 0) {
            let arr = [];
            for (let i = range.start.line; i <= range.end.line; i++) {
                let curr = await workspace_1.default.getLine(uri, range.start.line);
                let sc = i == range.start.line ? range.start.character : 0;
                let ec = i == range.end.line ? range.end.character : curr.length;
                if (sc == ec)
                    continue;
                arr.push(vscode_languageserver_protocol_1.Range.create(i, sc, i, ec));
            }
            for (let r of arr) {
                let line = await workspace_1.default.getLine(uri, r.start.line);
                let start = string_1.byteIndex(line, r.start.character) + 1;
                let end = string_1.byteIndex(line, r.end.character) + 1;
                nvim.call('matchaddpos', [this.hlGroup, [[lnum, start, end - start]]], true);
            }
        }
        if (!exists)
            nvim.command('setl nobuflisted bufhidden=wipe', true);
        nvim.command('normal! zz', true);
        nvim.call('win_gotoid', [winid], true);
        if (workspace_1.default.isVim)
            nvim.command('redraw', true);
        let [, err] = await nvim.resumeNotification();
        // tslint:disable-next-line: no-console
        if (err)
            console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`);
    }
    async preview(options, context) {
        let { nvim } = this;
        let { bufname, filetype, sketch, lines, lnum } = options;
        let mod = context.options.position == 'top' ? 'below' : 'above';
        let height = Math.min(this.previewHeight, lines ? Math.max(lines.length, 1) : Infinity);
        let winid = context.listWindow.id;
        let valid = await context.window.valid;
        nvim.pauseNotification();
        nvim.command('pclose', true);
        if (this.splitRight) {
            if (valid)
                nvim.call('win_gotoid', [context.window.id], true);
            nvim.command(`silent belowright vs +setl\\ previewwindow ${bufname}`, true);
        }
        else {
            nvim.command(`silent ${mod} ${height}sp +setl\\ previewwindow ${bufname}`, true);
        }
        if (lines) {
            nvim.call('append', [0, lines], true);
            nvim.command('normal! Gdd', true);
        }
        if (lnum)
            nvim.command(`exe ${lnum}`, true);
        nvim.command('setl winfixheight nomodifiable', true);
        if (sketch)
            nvim.command('setl buftype=nofile bufhidden=wipe nobuflisted', true);
        if (filetype == 'detect') {
            nvim.command('filetype detect', true);
        }
        else if (filetype) {
            nvim.command(`setf ${filetype}`, true);
        }
        nvim.command('normal! zz', true);
        nvim.call('win_gotoid', [winid], true);
        if (workspace_1.default.isVim)
            nvim.command('redraw', true);
        let [, err] = await nvim.resumeNotification();
        // tslint:disable-next-line: no-console
        if (err)
            console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`);
    }
    doHighlight() {
        // noop
    }
    dispose() {
        util_1.disposeAll(this.disposables);
    }
}
exports.default = BasicList;
//# sourceMappingURL=basic.js.map