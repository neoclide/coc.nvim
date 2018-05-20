"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../../model/source");
const buffers_1 = require("../../buffers");
const util_1 = require("../../util");
const which = require("which");
const { spawn } = require('child_process');
const logger = require('../../util/logger')('source-gocode');
class Gocode extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'gocode',
            shortcut: 'GOC',
            priority: 8,
            filetypes: ['go'],
            command: 'gocode',
        });
        this.disabled = false;
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { command } = this.config;
            if (command === 'gocode') {
                try {
                    which.sync('gocode');
                }
                catch (e) {
                    yield util_1.echoWarning(this.nvim, 'Could not find gocode in $PATH');
                    this.disabled = true;
                    return;
                }
            }
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.checkFileType(filetype) || this.disabled)
                return false;
            return true;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, filepath, linenr, col, input } = opt;
            let { document } = buffers_1.default;
            let { nvim, menu } = this;
            if (input.length) {
                // limit result
                col = col + 1;
            }
            let offset = document.getOffset(linenr, col);
            let { command } = this.config;
            const child = spawn(command, ['-f=vim', 'autocomplete', filepath, `c${offset}`]);
            return new Promise((resolve, reject) => {
                let output = '';
                let exited = false;
                child.stdout.on('data', data => {
                    output = output + data.toString();
                });
                child.on('exit', () => {
                    let exited = true;
                    if (!output)
                        return resolve(null);
                    try {
                        let list = JSON.parse(output.replace(/'/g, '"'));
                        logger.debug(list);
                        if (list.length < 2)
                            return resolve(null);
                        let items = list[1];
                        resolve({
                            items: items.map(item => {
                                return Object.assign({}, item, { word: item.word.replace(/\($/, ''), menu: item.menu ? `${item.menu} ${menu}` : menu });
                            })
                        });
                    }
                    catch (e) {
                        reject(new Error('invalid output from gocode'));
                    }
                });
                setTimeout(() => {
                    if (!exited) {
                        child.kill('SIGHUP');
                        reject(new Error('gocode timeout'));
                    }
                }, 2000);
                child.stdin.write(document.content, 'utf8');
                child.stdin.end();
            });
        });
    }
}
exports.default = Gocode;
//# sourceMappingURL=gocode.js.map