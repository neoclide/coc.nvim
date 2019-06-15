"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const floatBuffer_1 = tslib_1.__importDefault(require("../model/floatBuffer"));
const popup_1 = tslib_1.__importDefault(require("../model/popup"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('floating');
class Floating {
    constructor(nvim) {
        this.nvim = nvim;
        let configuration = workspace_1.default.getConfiguration('suggest');
        let enableFloat = configuration.get('floatEnable', true);
        let { env } = workspace_1.default;
        if (enableFloat && !env.floating && !env.textprop) {
            enableFloat = false;
        }
        this.config = {
            srcId: workspace_1.default.createNameSpace('coc-pum-float'),
            maxPreviewWidth: configuration.get('maxPreviewWidth', 80),
            enable: enableFloat
        };
    }
    get buffer() {
        let { floatBuffer } = this;
        return floatBuffer ? floatBuffer.buffer : null;
    }
    async showDocumentationFloating(docs, bounding, token) {
        let { nvim } = this;
        await this.checkBuffer();
        let rect = await this.calculateBounding(docs, bounding);
        let config = Object.assign({ relative: 'editor', }, rect);
        if (this.window) {
            let valid = await this.window.valid;
            if (!valid)
                this.window = null;
        }
        if (token.isCancellationRequested)
            return;
        if (!this.window) {
            try {
                let win = this.window = await nvim.openFloatWindow(this.buffer, false, config);
                if (token.isCancellationRequested) {
                    this.close();
                    return;
                }
                nvim.pauseNotification();
                win.setVar('float', 1, true);
                win.setVar('popup', 1, true);
                nvim.command(`noa call win_gotoid(${win.id})`, true);
                nvim.command(`setl nospell nolist wrap linebreak foldcolumn=1`, true);
                nvim.command(`setl nonumber norelativenumber nocursorline nocursorcolumn`, true);
                nvim.command(`setl signcolumn=no conceallevel=2`, true);
                nvim.command(`setl winhl=Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating`, true);
                nvim.command(`silent doautocmd User CocOpenFloat`, true);
                this.floatBuffer.setLines();
                nvim.call('cursor', [1, 1], true);
                nvim.command(`noa wincmd p`, true);
                let [, err] = await nvim.resumeNotification();
                // tslint:disable-next-line: no-console
                if (err)
                    console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`);
            }
            catch (e) {
                logger.error(`Create preview error:`, e.stack);
            }
        }
        else {
            nvim.pauseNotification();
            this.window.setConfig(config, true);
            nvim.command(`noa call win_gotoid(${this.window.id})`, true);
            nvim.call('cursor', [1, 1], true);
            this.floatBuffer.setLines();
            nvim.command(`noa wincmd p`, true);
            let [, err] = await nvim.resumeNotification();
            // tslint:disable-next-line: no-console
            if (err)
                console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`);
        }
    }
    async showDocumentationVim(docs, bounding, token) {
        let { nvim } = this;
        await this.checkBuffer();
        let rect = await this.calculateBounding(docs, bounding);
        if (token.isCancellationRequested)
            return this.close();
        nvim.pauseNotification();
        this.floatBuffer.setLines();
        this.popup.move({
            line: rect.row + 1,
            col: rect.col + 1,
            minwidth: rect.width,
            minheight: rect.height,
            maxwidth: rect.width,
            maxheight: rect.height
        });
        this.popup.show();
        nvim.command('redraw', true);
        let [, err] = await nvim.resumeNotification();
        // tslint:disable-next-line: no-console
        if (err)
            console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`);
    }
    async show(docs, bounding, token) {
        if (!this.config.enable)
            return;
        if (workspace_1.default.env.floating) {
            await this.showDocumentationFloating(docs, bounding, token);
        }
        else {
            await this.showDocumentationVim(docs, bounding, token);
        }
    }
    async calculateBounding(docs, bounding) {
        // drawn lines
        let { config, floatBuffer } = this;
        let { columns, lines } = workspace_1.default.env;
        let { maxPreviewWidth } = config;
        let pumWidth = bounding.width + (bounding.scrollbar ? 1 : 0);
        let showRight = true;
        let paddingRight = columns - bounding.col - pumWidth;
        if (bounding.col > paddingRight)
            showRight = false;
        let maxWidth = showRight ? paddingRight : bounding.col - 1;
        maxWidth = Math.min(maxPreviewWidth, maxWidth);
        await floatBuffer.setDocuments(docs, maxWidth);
        let maxHeight = lines - bounding.row - workspace_1.default.env.cmdheight - 1;
        return {
            col: showRight ? bounding.col + pumWidth : bounding.col - floatBuffer.width,
            row: bounding.row,
            height: Math.min(maxHeight, floatBuffer.getHeight(docs, maxWidth)),
            width: floatBuffer.width
        };
    }
    async checkBuffer() {
        let { buffer, nvim, popup } = this;
        if (workspace_1.default.env.textprop) {
            if (popup) {
                let visible = await popup.visible();
                if (!visible) {
                    popup.dispose();
                    popup = null;
                }
            }
            if (!popup) {
                this.popup = await popup_1.default(nvim, [''], {
                    padding: [0, 1, 0, 1],
                    highlight: 'CocFloating',
                    tab: -1,
                });
                let win = nvim.createWindow(this.popup.id);
                nvim.pauseNotification();
                win.setVar('float', 1, true);
                win.setVar('popup', 1, true);
                win.setOption('linebreak', true, true);
                win.setOption('showbreak', '', true);
                win.setOption('conceallevel', 2, true);
                await nvim.resumeNotification();
            }
            buffer = this.nvim.createBuffer(this.popup.bufferId);
            this.floatBuffer = new floatBuffer_1.default(nvim, buffer, nvim.createWindow(this.popup.id));
        }
        else {
            if (buffer) {
                let valid = await buffer.valid;
                if (valid)
                    return;
            }
            buffer = await this.nvim.createNewBuffer(false, true);
            await buffer.setOption('buftype', 'nofile');
            await buffer.setOption('bufhidden', 'hide');
            this.floatBuffer = new floatBuffer_1.default(nvim, buffer);
        }
    }
    close() {
        if (workspace_1.default.env.textprop) {
            if (this.popup) {
                this.popup.dispose();
            }
            return;
        }
        let { window } = this;
        if (!window)
            return;
        this.window = null;
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
                    window = null;
                    clearInterval(interval);
                }
            }, _e => {
                clearInterval(interval);
            });
        }, 200);
    }
}
exports.default = Floating;
//# sourceMappingURL=floating.js.map