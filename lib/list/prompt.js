"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('list-prompt');
class Prompt {
    constructor(nvim, config) {
        this.nvim = nvim;
        this.config = config;
        this.cusorIndex = 0;
        this._input = '';
        this._mode = 'insert';
        this.interactive = false;
        this._onDidChangeInput = new vscode_languageserver_protocol_1.Emitter();
        this.onDidChangeInput = this._onDidChangeInput.event;
    }
    get input() {
        return this._input;
    }
    set input(str) {
        if (this._input == str)
            return;
        this.cusorIndex = str.length;
        this._input = str;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    get mode() {
        return this._mode;
    }
    set mode(val) {
        if (val == this._mode)
            return;
        this._mode = val;
        this.drawPrompt();
    }
    set matcher(val) {
        this._matcher = val;
        this.drawPrompt();
    }
    start(opts) {
        if (opts) {
            this.interactive = opts.interactive;
            this._input = opts.input;
            this.cusorIndex = opts.input.length;
            this._mode = opts.mode;
            this._matcher = opts.interactive ? '' : opts.matcher;
        }
        let fn = workspace_1.default.isVim ? 'coc#list#prompt_start' : 'coc#list#start_prompt';
        this.nvim.call(fn, [], true);
        this.drawPrompt();
    }
    cancel() {
        let { nvim } = this;
        nvim.command('echo ""', true);
        nvim.command('redraw', true);
        nvim.call('coc#list#stop_prompt', [], true);
    }
    reset() {
        this._input = '';
        this.cusorIndex = 0;
    }
    drawPrompt() {
        let indicator = this.config.get('indicator', '>');
        let { cusorIndex, interactive, input, _matcher } = this;
        let cmds = workspace_1.default.isVim ? ['echo ""'] : ['redraw'];
        if (this.mode == 'insert') {
            if (interactive) {
                cmds.push(`echohl MoreMsg | echon 'INTERACTIVE ' | echohl None`);
            }
            else if (_matcher) {
                cmds.push(`echohl MoreMsg | echon '${_matcher.toUpperCase()} ' | echohl None`);
            }
            cmds.push(`echohl Special | echon '${indicator} ' | echohl None`);
            if (cusorIndex == input.length) {
                cmds.push(`echon '${input.replace(/'/g, "''")}'`);
                if (workspace_1.default.isVim) {
                    cmds.push(`echohl Cursor | echon ' ' | echohl None`);
                }
            }
            else {
                let pre = input.slice(0, cusorIndex);
                if (pre)
                    cmds.push(`echon '${pre.replace(/'/g, "''")}'`);
                cmds.push(`echohl Cursor | echon '${input[cusorIndex].replace(/'/, "''")}' | echohl None`);
                let post = input.slice(cusorIndex + 1);
                cmds.push(`echon '${post.replace(/'/g, "''")}'`);
            }
        }
        else {
            cmds.push(`echohl MoreMsg | echo "" | echohl None`);
        }
        if (workspace_1.default.isVim)
            cmds.push('redraw');
        let cmd = cmds.join('|');
        this.nvim.command(cmd, true);
    }
    moveLeft() {
        if (this.cusorIndex == 0)
            return;
        this.cusorIndex = this.cusorIndex - 1;
        this.drawPrompt();
    }
    moveRight() {
        if (this.cusorIndex == this._input.length)
            return;
        this.cusorIndex = this.cusorIndex + 1;
        this.drawPrompt();
    }
    moveToEnd() {
        if (this.cusorIndex == this._input.length)
            return;
        this.cusorIndex = this._input.length;
        this.drawPrompt();
    }
    moveToStart() {
        if (this.cusorIndex == 0)
            return;
        this.cusorIndex = 0;
        this.drawPrompt();
    }
    onBackspace() {
        let { cusorIndex, input } = this;
        if (cusorIndex == 0)
            return;
        let pre = input.slice(0, cusorIndex);
        let post = input.slice(cusorIndex);
        this.cusorIndex = cusorIndex - 1;
        this._input = `${pre.slice(0, pre.length - 1)}${post}`;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    removeNext() {
        let { cusorIndex, input } = this;
        if (cusorIndex == input.length - 1)
            return;
        let pre = input.slice(0, cusorIndex);
        let post = input.slice(cusorIndex + 1);
        this._input = `${pre}${post}`;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    removeWord() {
        let { cusorIndex, input } = this;
        if (cusorIndex == 0)
            return;
        let pre = input.slice(0, cusorIndex);
        let post = input.slice(cusorIndex);
        let remain = pre.replace(/[\w$]+([^\w$]+)?$/, '');
        this.cusorIndex = cusorIndex - (pre.length - remain.length);
        this._input = `${remain}${post}`;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    removeTail() {
        let { cusorIndex, input } = this;
        if (cusorIndex == input.length)
            return;
        let pre = input.slice(0, cusorIndex);
        this._input = pre;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    removeAhead() {
        let { cusorIndex, input } = this;
        if (cusorIndex == 0)
            return;
        let post = input.slice(cusorIndex);
        this.cusorIndex = 0;
        this._input = post;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    insertCharacter(ch) {
        let { cusorIndex, input } = this;
        this.cusorIndex = cusorIndex + 1;
        let pre = input.slice(0, cusorIndex);
        let post = input.slice(cusorIndex);
        this._input = `${pre}${ch}${post}`;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
    async paste() {
        let { cusorIndex, input } = this;
        let text = await this.nvim.eval('@*');
        text = text.replace(/\n/g, '');
        this.cusorIndex = cusorIndex + text.length;
        let pre = input.slice(0, cusorIndex);
        let post = input.slice(cusorIndex);
        this._input = `${pre}${text}${post}`;
        this.drawPrompt();
        this._onDidChangeInput.fire(this._input);
    }
}
exports.default = Prompt;
//# sourceMappingURL=prompt.js.map