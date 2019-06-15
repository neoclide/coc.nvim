"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const events_1 = tslib_1.__importDefault(require("../events"));
const manager_1 = tslib_1.__importDefault(require("../snippets/manager"));
const util_1 = require("../util");
const object_1 = require("../util/object");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const floatBuffer_1 = tslib_1.__importDefault(require("./floatBuffer"));
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const popup_1 = tslib_1.__importDefault(require("./popup"));
const logger = require('../util/logger')('model-float');
// factory class for floating window
class FloatFactory {
    constructor(nvim, env, preferTop = false, maxHeight = 999, maxWidth) {
        this.nvim = nvim;
        this.env = env;
        this.preferTop = preferTop;
        this.maxHeight = maxHeight;
        this.maxWidth = maxWidth;
        this.disposables = [];
        this.alignTop = false;
        this.createTs = 0;
        this.cursor = [0, 0];
        if (!env.floating && !env.textprop)
            return;
        events_1.default.on('BufEnter', bufnr => {
            if (this.buffer && bufnr == this.buffer.id)
                return;
            if (bufnr == this.targetBufnr)
                return;
            this.close();
        }, null, this.disposables);
        events_1.default.on('InsertLeave', bufnr => {
            if (this.buffer && bufnr == this.buffer.id)
                return;
            if (manager_1.default.isActived(bufnr))
                return;
            this.close();
        }, null, this.disposables);
        events_1.default.on('MenuPopupChanged', async (ev, cursorline) => {
            if (cursorline < ev.row && !this.alignTop) {
                this.close();
            }
            else if (cursorline > ev.row && this.alignTop) {
                this.close();
            }
        }, null, this.disposables);
        let onCursorMoved = debounce_1.default(this.onCursorMoved.bind(this), 100);
        events_1.default.on('CursorMovedI', onCursorMoved, this, this.disposables);
        events_1.default.on('CursorMoved', onCursorMoved, this, this.disposables);
    }
    onCursorMoved(bufnr, cursor) {
        if (!this.window)
            return;
        if (this.buffer && bufnr == this.buffer.id)
            return;
        if (bufnr == this.targetBufnr && object_1.equals(cursor, this.cursor))
            return;
        if (!workspace_1.default.insertMode || bufnr != this.targetBufnr) {
            this.close();
            return;
        }
        let ts = Date.now();
        setTimeout(() => {
            if (this.createTs > ts)
                return;
            this.close();
        }, 500);
    }
    async checkFloatBuffer() {
        let { floatBuffer, nvim, window } = this;
        if (this.env.textprop) {
            let valid = await this.activated();
            if (!valid)
                window = null;
            if (!window) {
                this.popup = await popup_1.default(nvim, [''], {
                    padding: [0, 1, 0, 1],
                    highlight: 'CocFloating',
                    tab: -1,
                });
                let win = this.window = nvim.createWindow(this.popup.id);
                nvim.pauseNotification();
                win.setVar('float', 1, true);
                win.setOption('linebreak', true, true);
                win.setOption('showbreak', '', true);
                win.setOption('conceallevel', 2, true);
                await nvim.resumeNotification();
            }
            let buffer = this.nvim.createBuffer(this.popup.bufferId);
            this.floatBuffer = new floatBuffer_1.default(nvim, buffer, nvim.createWindow(this.popup.id));
        }
        else {
            if (floatBuffer) {
                let valid = await floatBuffer.valid;
                if (valid)
                    return;
            }
            let buf = await this.nvim.createNewBuffer(false, true);
            await buf.setOption('buftype', 'nofile');
            await buf.setOption('bufhidden', 'hide');
            this.floatBuffer = new floatBuffer_1.default(this.nvim, buf);
        }
    }
    get columns() {
        return this.env.columns;
    }
    get lines() {
        return this.env.lines - this.env.cmdheight - 1;
    }
    async getBoundings(docs, offsetX = 0) {
        let { nvim, preferTop } = this;
        let { columns, lines } = this;
        let alignTop = false;
        let [row, col] = await nvim.call('coc#util#win_position');
        let maxWidth = this.maxWidth || Math.min(columns - 10, 82);
        let height = this.floatBuffer.getHeight(docs, maxWidth);
        height = Math.min(height, this.maxHeight);
        if (!preferTop) {
            if (lines - row < height && row > height) {
                alignTop = true;
            }
        }
        else {
            if (row >= height || row >= lines - row) {
                alignTop = true;
            }
        }
        if (alignTop)
            docs.reverse();
        await this.floatBuffer.setDocuments(docs, maxWidth);
        let { width } = this.floatBuffer;
        offsetX = Math.min(col - 1, offsetX);
        if (col - offsetX + width > columns) {
            offsetX = col - offsetX + width - columns;
        }
        this.alignTop = alignTop;
        return {
            height: alignTop ? Math.min(row, height) : Math.min(height, (lines - row)),
            width: Math.min(columns, width),
            row: alignTop ? -height : 1,
            col: offsetX == 0 ? 0 : -offsetX,
            relative: 'cursor'
        };
    }
    async create(docs, allowSelection = false, offsetX = 0) {
        if (this.env.floating) {
            await this.createNvim(docs, allowSelection, offsetX);
        }
        else if (this.env.textprop) {
            await this.createVim(docs, allowSelection, offsetX);
        }
    }
    async createVim(docs, allowSelection = false, offsetX = 0) {
        if (docs.length == 0) {
            this.close();
            return;
        }
        if (this.tokenSource) {
            this.tokenSource.cancel();
        }
        this.createTs = Date.now();
        this.targetBufnr = workspace_1.default.bufnr;
        let tokenSource = this.tokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        let token = tokenSource.token;
        await this.checkFloatBuffer();
        let config = await this.getBoundings(docs, offsetX);
        let [mode, line, col] = await this.nvim.eval('[mode(),line("."),col(".")]');
        this.cursor = [line, col];
        if (!config || token.isCancellationRequested)
            return this.popup.dispose();
        allowSelection = mode == 's' && allowSelection;
        if (['i', 'n', 'ic'].indexOf(mode) !== -1 || allowSelection) {
            let { nvim, alignTop } = this;
            let reuse = false;
            let filetypes = docs.reduce((p, curr) => {
                if (p.indexOf(curr.filetype) == -1) {
                    p.push(curr.filetype);
                }
                return p;
            }, []);
            nvim.pauseNotification();
            let { popup, window } = this;
            this.popup.move({
                line: cursorPostion(config.row),
                col: cursorPostion(config.col),
                minwidth: config.width - 2,
                minheight: config.height,
                maxwidth: config.width - 2,
                maxheight: config.height
            });
            this.floatBuffer.setLines();
            // nvim.call('win_execute', [window.id, `normal! G`], true)
            if (filetypes.length == 1) {
                this.popup.setFiletype(filetypes[0]);
            }
            let [res, err] = await nvim.resumeNotification();
            if (err) {
                workspace_1.default.showMessage(`Error on ${err[0]}: ${err[1]} - ${err[2]}`, 'error');
                return;
            }
            if (mode == 's')
                await manager_1.default.selectCurrentPlaceholder(false);
        }
    }
    async createNvim(docs, allowSelection = false, offsetX = 0) {
        if (docs.length == 0) {
            this.close();
            return;
        }
        if (this.tokenSource) {
            this.tokenSource.cancel();
        }
        this.createTs = Date.now();
        this.targetBufnr = workspace_1.default.bufnr;
        let tokenSource = this.tokenSource = new vscode_languageserver_protocol_1.CancellationTokenSource();
        let token = tokenSource.token;
        await this.checkFloatBuffer();
        let config = await this.getBoundings(docs, offsetX);
        let [mode, line, col] = await this.nvim.eval('[mode(),line("."),col(".")]');
        this.cursor = [line, col];
        if (!config || token.isCancellationRequested)
            return;
        allowSelection = mode == 's' && allowSelection;
        if (['i', 'n', 'ic'].indexOf(mode) !== -1 || allowSelection) {
            let { nvim, alignTop } = this;
            // change to normal
            if (mode == 's')
                await nvim.call('feedkeys', ['\x1b', 'in']);
            // helps to fix undo issue, don't know why.
            if (mode.startsWith('i'))
                await nvim.eval('feedkeys("\\<C-g>u", "n")');
            let reuse = false;
            if (this.window)
                reuse = await this.window.valid;
            if (token.isCancellationRequested)
                return;
            nvim.pauseNotification();
            if (!reuse) {
                nvim.notify('nvim_open_win', [this.buffer, true, config]);
                nvim.command(`let w:float = 1`, true);
                nvim.command(`setl nospell nolist wrap linebreak foldcolumn=1`, true);
                nvim.command(`setl nonumber norelativenumber nocursorline nocursorcolumn`, true);
                nvim.command(`setl signcolumn=no conceallevel=2`, true);
                nvim.command(`setl winhl=Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating`, true);
                nvim.command(`silent doautocmd User CocOpenFloat`, true);
            }
            else {
                this.window.setConfig(config, true);
                nvim.command(`noa call win_gotoid(${this.window.id})`, true);
            }
            this.floatBuffer.setLines();
            nvim.command(`normal! ${alignTop ? 'G' : 'gg'}0`, true);
            nvim.command('noa wincmd p', true);
            let [res, err] = await nvim.resumeNotification();
            if (err) {
                workspace_1.default.showMessage(`Error on ${err[0]}: ${err[1]} - ${err[2]}`, 'error');
                return;
            }
            if (!reuse)
                this.window = res[0];
            if (mode == 's')
                await manager_1.default.selectCurrentPlaceholder(false);
        }
    }
    /**
     * Close float window
     */
    close() {
        if (this.tokenSource) {
            this.tokenSource.cancel();
            this.tokenSource = null;
        }
        if (this.popup) {
            this.popup.dispose();
        }
        else {
            this.closeWindow(this.window);
        }
    }
    closeWindow(window) {
        if (!window)
            return;
        this.nvim.call('coc#util#close_win', window.id, true);
        this.window = null;
        let count = 0;
        let interval = setInterval(() => {
            count++;
            if (count == 5)
                clearInterval(interval);
            window.valid.then(valid => {
                if (valid) {
                    this.nvim.call('coc#util#close_win', window.id, true);
                }
                else {
                    clearInterval(interval);
                }
            }, _e => {
                clearInterval(interval);
            });
        }, 200);
    }
    dispose() {
        if (this.tokenSource) {
            this.tokenSource.cancel();
        }
        util_1.disposeAll(this.disposables);
    }
    get buffer() {
        return this.floatBuffer ? this.floatBuffer.buffer : null;
    }
    async activated() {
        if (this.env.textprop) {
            if (!this.popup)
                return false;
            return await this.popup.visible();
        }
        if (!this.window)
            return false;
        let valid = await this.window.valid;
        return valid;
    }
}
exports.default = FloatFactory;
function cursorPostion(n) {
    if (n == 0)
        return 'cursor';
    if (n < 0)
        return `cursor${n}`;
    return `cursor+${n}`;
}
//# sourceMappingURL=floatFactory.js.map