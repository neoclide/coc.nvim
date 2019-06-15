"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const events_1 = tslib_1.__importDefault(require("../events"));
const util_1 = require("../util");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const debounce = require("debounce");
const logger = require('../util/logger')('list-ui');
class ListUI {
    constructor(nvim, config) {
        this.nvim = nvim;
        this.config = config;
        this._bufnr = 0;
        this.currIndex = 0;
        this.highlights = [];
        this.items = [];
        this.disposables = [];
        this.selected = new Set();
        this.creating = false;
        this._onDidChangeLine = new vscode_languageserver_protocol_1.Emitter();
        this._onDidOpen = new vscode_languageserver_protocol_1.Emitter();
        this._onDidClose = new vscode_languageserver_protocol_1.Emitter();
        this._onDidChange = new vscode_languageserver_protocol_1.Emitter();
        this._onDidLineChange = new vscode_languageserver_protocol_1.Emitter();
        this._onDoubleClick = new vscode_languageserver_protocol_1.Emitter();
        this.hlGroupMap = new Map();
        this.onDidChangeLine = this._onDidChangeLine.event;
        this.onDidLineChange = this._onDidLineChange.event;
        this.onDidOpen = this._onDidOpen.event;
        this.onDidClose = this._onDidClose.event;
        this.onDidChange = this._onDidChange.event;
        this.onDidDoubleClick = this._onDoubleClick.event;
        let signText = config.get('selectedSignText', '*');
        nvim.command(`sign define CocSelected text=${signText} texthl=CocSelectedText linehl=CocSelectedLine`, true);
        this.signOffset = config.get('signOffset');
        events_1.default.on('BufUnload', async (bufnr) => {
            if (bufnr == this.bufnr) {
                this._bufnr = 0;
                this.window = null;
                this._onDidClose.fire(bufnr);
            }
        }, null, this.disposables);
        let timer;
        events_1.default.on('CursorMoved', async (bufnr, cursor) => {
            if (timer)
                clearTimeout(timer);
            if (bufnr != this.bufnr)
                return;
            let lnum = cursor[0];
            if (this.currIndex + 1 != lnum) {
                this.currIndex = lnum - 1;
                this._onDidChangeLine.fire(lnum);
            }
        }, null, this.disposables);
        events_1.default.on('CursorMoved', debounce(async (bufnr) => {
            if (bufnr != this.bufnr)
                return;
            // if (this.length < 500) return
            let [start, end] = await nvim.eval('[line("w0"),line("w$")]');
            // if (end < 500) return
            nvim.pauseNotification();
            this.doHighlight(start - 1, end);
            nvim.command('redraw', true);
            await nvim.resumeNotification(false, true);
        }, 50));
        nvim.call('coc#list#get_colors').then(map => {
            for (let key of Object.keys(map)) {
                let foreground = key[0].toUpperCase() + key.slice(1);
                let foregroundColor = map[key];
                for (let key of Object.keys(map)) {
                    let background = key[0].toUpperCase() + key.slice(1);
                    let backgroundColor = map[key];
                    let group = `CocList${foreground}${background}`;
                    this.hlGroupMap.set(group, `hi default CocList${foreground}${background} guifg=${foregroundColor} guibg=${backgroundColor}`);
                }
                this.hlGroupMap.set(`CocListFg${foreground}`, `hi default CocListFg${foreground} guifg=${foregroundColor}`);
                this.hlGroupMap.set(`CocListBg${foreground}`, `hi default CocListBg${foreground} guibg=${foregroundColor}`);
            }
        }, _e => {
            // noop
        });
    }
    set index(n) {
        if (n < 0 || n >= this.items.length)
            return;
        this.currIndex = n;
        if (this.window) {
            let { nvim } = this;
            nvim.pauseNotification();
            this.setCursor(n + 1, 0);
            nvim.command('redraw', true);
            nvim.resumeNotification(false, true).catch(_e => {
                // noop
            });
        }
    }
    get index() {
        return this.currIndex;
    }
    getItem(delta) {
        let { currIndex } = this;
        return this.items[currIndex + delta];
    }
    get item() {
        let { window } = this;
        if (!window)
            return Promise.resolve(null);
        return window.cursor.then(cursor => {
            this.currIndex = cursor[0] - 1;
            return this.items[this.currIndex];
        }, _e => {
            return null;
        });
    }
    async echoMessage(item) {
        if (this.bufnr)
            return;
        let { items } = this;
        let idx = items.indexOf(item);
        let msg = `[${idx + 1}/${items.length}] ${item.label || ''}`;
        this.nvim.callTimer('coc#util#echo_lines', [[msg]], true);
    }
    async updateItem(item, index) {
        if (!this.bufnr || workspace_1.default.bufnr != this.bufnr)
            return;
        let obj = Object.assign({ resolved: true }, item);
        if (index < this.length) {
            this.items[index] = obj;
            let { nvim } = this;
            nvim.pauseNotification();
            nvim.command('setl modifiable', true);
            nvim.call('setline', [index + 1, obj.label], true);
            nvim.command('setl nomodifiable', true);
            await nvim.resumeNotification();
        }
    }
    async getItems() {
        if (this.length == 0)
            return [];
        let mode = await this.nvim.call('mode');
        if (mode == 'v' || mode == 'V') {
            let [start, end] = await this.getSelectedRange();
            let res = [];
            for (let i = start; i <= end; i++) {
                res.push(this.items[i - 1]);
            }
            return res;
        }
        let { selectedItems } = this;
        if (selectedItems.length)
            return selectedItems;
        let item = await this.item;
        return item == null ? [] : [item];
    }
    async onMouse(event) {
        let { nvim, window } = this;
        let winid = await nvim.getVvar('mouse_winid');
        if (!window)
            return;
        let lnum = await nvim.getVvar('mouse_lnum');
        let col = await nvim.getVvar('mouse_col');
        if (event == 'mouseDown') {
            this.mouseDown = { winid, lnum, col, current: winid == window.id };
            return;
        }
        let current = winid == window.id;
        if (current && event == 'doubleClick') {
            this.setCursor(lnum, 0);
            this._onDoubleClick.fire();
        }
        if (!this.mouseDown || this.mouseDown.winid != this.mouseDown.winid)
            return;
        if (current && event == 'mouseDrag') {
            await this.selectLines(this.mouseDown.lnum, lnum);
        }
        else if (current && event == 'mouseUp') {
            if (this.mouseDown.lnum == lnum) {
                nvim.pauseNotification();
                this.clearSelection();
                this.setCursor(lnum, 0);
                nvim.command('redraw', true);
                await nvim.resumeNotification();
            }
            else {
                await this.selectLines(this.mouseDown.lnum, lnum);
            }
        }
        else if (!current && event == 'mouseUp') {
            nvim.pauseNotification();
            nvim.call('win_gotoid', winid, true);
            nvim.call('cursor', [lnum, col], true);
            await nvim.resumeNotification();
        }
    }
    reset() {
        this.items = [];
        this.mouseDown = null;
        this.selected = new Set();
        this._bufnr = 0;
        this.window = null;
    }
    hide() {
        let { bufnr, nvim } = this;
        if (bufnr) {
            this._bufnr = 0;
            nvim.command(`silent! bd! ${bufnr}`, true);
        }
    }
    async resume(name, position) {
        let { items, selected, nvim, signOffset } = this;
        await this.drawItems(items, name, position, true);
        if (selected.size > 0 && this.bufnr) {
            nvim.pauseNotification();
            for (let lnum of selected) {
                nvim.command(`sign place ${signOffset + lnum} line=${lnum} name=CocSelected buffer=${this.bufnr}`, true);
            }
            await nvim.resumeNotification();
        }
    }
    async toggleSelection() {
        let { nvim, selected, signOffset, bufnr } = this;
        if (workspace_1.default.bufnr != bufnr)
            return;
        let lnum = await nvim.call('line', '.');
        let mode = await nvim.call('mode');
        if (mode == 'v' || mode == 'V') {
            let [start, end] = await this.getSelectedRange();
            let exists = selected.has(start);
            let reverse = start > end;
            if (reverse)
                [start, end] = [end, start];
            for (let i = start; i <= end; i++) {
                if (!exists) {
                    selected.add(i);
                    nvim.command(`sign place ${signOffset + i} line=${i} name=CocSelected buffer=${bufnr}`, true);
                }
                else {
                    selected.delete(i);
                    nvim.command(`sign unplace ${signOffset + i} buffer=${bufnr}`, true);
                }
            }
            this.setCursor(end, 0);
            nvim.command('redraw', true);
            await nvim.resumeNotification();
            return;
        }
        let exists = selected.has(lnum);
        nvim.pauseNotification();
        if (exists) {
            selected.delete(lnum);
            nvim.command(`sign unplace ${signOffset + lnum} buffer=${bufnr}`, true);
        }
        else {
            selected.add(lnum);
            nvim.command(`sign place ${signOffset + lnum} line=${lnum} name=CocSelected buffer=${bufnr}`, true);
        }
        this.setCursor(lnum + 1, 0);
        nvim.command('redraw', true);
        await nvim.resumeNotification();
    }
    async selectLines(start, end) {
        let { nvim, signOffset, bufnr, length } = this;
        this.clearSelection();
        let { selected } = this;
        nvim.pauseNotification();
        let reverse = start > end;
        if (reverse)
            [start, end] = [end, start];
        for (let i = start; i <= end; i++) {
            if (i > length)
                break;
            selected.add(i);
            nvim.command(`sign place ${signOffset + i} line=${i} name=CocSelected buffer=${bufnr}`, true);
        }
        this.setCursor(end, 0);
        nvim.command('redraw', true);
        await nvim.resumeNotification();
    }
    async selectAll() {
        let { length } = this;
        if (length == 0)
            return;
        await this.selectLines(1, length);
    }
    clearSelection() {
        let { selected, nvim, signOffset, bufnr } = this;
        if (!bufnr)
            return;
        if (selected.size > 0) {
            let signIds = [];
            for (let lnum of selected) {
                signIds.push(signOffset + lnum);
            }
            nvim.call('coc#util#unplace_signs', [bufnr, signIds], true);
            this.selected = new Set();
        }
    }
    get shown() {
        return this._bufnr != 0;
    }
    get bufnr() {
        return this._bufnr;
    }
    get ready() {
        if (this._bufnr)
            return Promise.resolve();
        if (this.creating) {
            return new Promise(resolve => {
                let disposable = this.onDidOpen(() => {
                    disposable.dispose();
                    resolve();
                });
            });
        }
    }
    async drawItems(items, name, position = 'bottom', reload = false) {
        let { bufnr, config, nvim } = this;
        let maxHeight = config.get('maxHeight', 12);
        let height = Math.max(1, Math.min(items.length, maxHeight));
        let limitLines = config.get('limitLines', 1000);
        let curr = this.items[this.index];
        this.items = items.slice(0, limitLines);
        if (bufnr == 0 && !this.creating) {
            this.creating = true;
            let [bufnr, winid] = await workspace_1.default.callAsync('coc#list#create', [position, height, name]);
            this._bufnr = bufnr;
            this.window = nvim.createWindow(winid);
            this.height = height;
            this._onDidOpen.fire(this.bufnr);
            this.creating = false;
        }
        else {
            await this.ready;
        }
        let lines = this.items.map(item => item.label);
        this.clearSelection();
        await this.setLines(lines, false, reload ? this.currIndex : 0);
        let item = this.items[this.index] || { label: '' };
        if (!curr || curr.label != item.label) {
            this._onDidLineChange.fire(this.index + 1);
        }
    }
    async appendItems(items) {
        let { config } = this;
        let limitLines = config.get('limitLines', 1000);
        let curr = this.items.length;
        if (curr >= limitLines) {
            this._onDidChange.fire();
            return;
        }
        let max = limitLines - curr;
        let append = items.slice(0, max);
        this.items = this.items.concat(append);
        if (this.creating)
            return;
        await this.setLines(append.map(item => item.label), curr > 0, this.currIndex);
    }
    async setLines(lines, append = false, index) {
        let { nvim, bufnr, window, config } = this;
        if (!bufnr || !window)
            return;
        let resize = config.get('autoResize', true);
        let buf = nvim.createBuffer(bufnr);
        nvim.pauseNotification();
        nvim.call('win_gotoid', window.id, true);
        if (!append) {
            nvim.call('clearmatches', [], true);
        }
        if (resize) {
            let maxHeight = config.get('maxHeight', 12);
            let height = Math.max(1, Math.min(this.items.length, maxHeight));
            this.height = height;
            window.notify(`nvim_win_set_height`, [height]);
        }
        if (!append) {
            if (!lines.length) {
                lines = ['Press ? on normal mode to get help.'];
                nvim.call('matchaddpos', ['Comment', [[1]], 99], true);
            }
        }
        nvim.command('setl modifiable', true);
        if (workspace_1.default.isVim) {
            nvim.call('coc#list#setlines', [lines, append], true);
        }
        else {
            buf.setLines(lines, { start: append ? -1 : 0, end: -1, strictIndexing: false }, true);
        }
        nvim.command('setl nomodifiable', true);
        if (!append && index == 0) {
            this.doHighlight(0, 500);
        }
        else {
            this.doHighlight(Math.max(0, index - this.height), Math.min(index + this.height + 1, this.length - 1));
        }
        if (!append)
            window.notify('nvim_win_set_cursor', [[index + 1, 0]]);
        this._onDidChange.fire();
        if (workspace_1.default.isVim)
            nvim.command('redraw', true);
        nvim.resumeNotification(false, true).catch(_e => {
            // noop
        });
    }
    async restoreWindow() {
        let { window, height } = this;
        if (window && height) {
            await workspace_1.default.callAsync('coc#list#restore', [window.id, height]);
        }
    }
    dispose() {
        util_1.disposeAll(this.disposables);
    }
    get length() {
        return this.items.length;
    }
    get selectedItems() {
        let { selected, items } = this;
        let res = [];
        for (let i of selected) {
            if (items[i - 1])
                res.push(items[i - 1]);
        }
        return res;
    }
    doHighlight(start, end) {
        let { nvim } = workspace_1.default;
        let { highlights, items } = this;
        for (let i = start; i <= Math.min(end, items.length - 1); i++) {
            let { ansiHighlights } = items[i];
            let highlight = highlights[i];
            if (ansiHighlights) {
                for (let hi of ansiHighlights) {
                    let { span, hlGroup } = hi;
                    this.setHighlightGroup(hlGroup);
                    nvim.call('matchaddpos', [hlGroup, [[i + 1, span[0] + 1, span[1] - span[0]]], 9], true);
                }
            }
            if (highlight) {
                let { spans, hlGroup } = highlight;
                for (let span of spans) {
                    nvim.call('matchaddpos', [hlGroup || 'Search', [[i + 1, span[0] + 1, span[1] - span[0]]], 11], true);
                }
            }
        }
    }
    setHighlightGroup(hlGroup) {
        let { nvim } = workspace_1.default;
        if (this.hlGroupMap.has(hlGroup)) {
            let cmd = this.hlGroupMap.get(hlGroup);
            this.hlGroupMap.delete(hlGroup);
            nvim.command(cmd, true);
        }
    }
    setCursor(lnum, col) {
        let { window, bufnr, items } = this;
        let max = items.length == 0 ? 1 : items.length;
        if (!bufnr || !window || lnum > max)
            return;
        window.notify('nvim_win_set_cursor', [[lnum, col]]);
        if (this.currIndex + 1 != lnum) {
            this.currIndex = lnum - 1;
            this._onDidChangeLine.fire(lnum);
        }
    }
    addHighlights(highlights, append = false) {
        let limitLines = this.config.get('limitLines', 1000);
        if (!append) {
            this.highlights = highlights.slice(0, limitLines);
        }
        else {
            if (this.highlights.length < limitLines) {
                this.highlights = this.highlights.concat(highlights.slice(0, limitLines - this.highlights.length));
            }
        }
    }
    async getSelectedRange() {
        let { nvim } = this;
        await nvim.call('coc#list#stop_prompt');
        await nvim.eval('feedkeys("\\<esc>", "in")');
        let [, start] = await nvim.call('getpos', "'<");
        let [, end] = await nvim.call('getpos', "'>");
        if (start > end) {
            [start, end] = [end, start];
        }
        let method = workspace_1.default.isVim ? 'coc#list#prompt_start' : 'coc#list#start_prompt';
        this.nvim.call(method, [], true);
        return [start, end];
    }
}
exports.default = ListUI;
//# sourceMappingURL=ui.js.map