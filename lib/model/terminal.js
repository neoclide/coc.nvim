"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const isVim = process.env.VIM_NODE_RPC == '1';
const logger = require('../util/logger')('model-terminal');
class TerminalModel {
    constructor(cmd, args, nvim, _name) {
        this.cmd = cmd;
        this.args = args;
        this.nvim = nvim;
        this._name = _name;
    }
    async start(cwd, env) {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('belowright 5new', true);
        nvim.command('setl winfixheight', true);
        nvim.command('setl norelativenumber', true);
        nvim.command('setl nonumber', true);
        if (env && Object.keys(env).length) {
            for (let key of Object.keys(env)) {
                nvim.command(`let $${key}='${env[key].replace(/'/g, "''")}'`, true);
            }
        }
        await nvim.resumeNotification();
        this.bufnr = await nvim.call('bufnr', '%');
        let cmd = [this.cmd, ...this.args];
        let opts = {};
        if (cwd)
            opts.cwd = cwd;
        this.chanId = await nvim.call('termopen', [cmd, opts]);
        if (env && Object.keys(env).length) {
            for (let key of Object.keys(env)) {
                nvim.command(`unlet $${key}`, true);
            }
        }
        await nvim.command('wincmd p');
    }
    get name() {
        return this._name || this.cmd;
    }
    get processId() {
        if (!this.chanId)
            return null;
        return this.nvim.call('jobpid', this.chanId);
    }
    sendText(text, addNewLine = true) {
        let { chanId, nvim } = this;
        if (!chanId)
            return;
        let lines = text.split(/\r?\n/);
        if (addNewLine && lines[lines.length - 1].length > 0) {
            lines.push('');
        }
        nvim.call('chansend', [chanId, lines], true);
    }
    async show(preserveFocus) {
        let { bufnr, nvim } = this;
        if (!bufnr)
            return;
        let winnr = await nvim.call('bufwinnr', bufnr);
        nvim.pauseNotification();
        if (winnr == -1) {
            nvim.command(`below ${bufnr}sb`, true);
            nvim.command('resize 5', true);
        }
        else {
            nvim.command(`${winnr}wincmd w`, true);
        }
        nvim.command('normal! G', true);
        if (preserveFocus) {
            nvim.command('wincmd p', true);
        }
        await nvim.resumeNotification();
    }
    async hide() {
        let { bufnr, nvim } = this;
        if (!bufnr)
            return;
        let winnr = await nvim.call('bufwinnr', bufnr);
        if (winnr == -1)
            return;
        await nvim.command(`${winnr}close!`);
    }
    dispose() {
        let { bufnr, chanId, nvim } = this;
        if (!chanId)
            return;
        nvim.call('chanclose', [chanId], true);
        nvim.command(`silent! bd! ${bufnr}`, true);
    }
}
exports.default = TerminalModel;
//# sourceMappingURL=terminal.js.map