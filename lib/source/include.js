"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const fs = require("fs");
const fs_1 = require("../util/fs");
const path = require("path");
const pify = require("pify");
const exec = require('child_process').exec;
const logger = require('../util/logger')('source-include');
const baseDir = path.join(__dirname, 'include_resolve');
class Include extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'include',
            shortcut: 'I',
            priority: 0,
            engross: 1,
            filetypes: [],
            trimSameExts: ['.ts', '.js'],
        });
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let files = yield pify(fs.readdir)(baseDir);
            files = files.filter(f => /\.js$/.test(f));
            let filetypes = files.map(f => f.replace(/\.js$/, ''));
            this.config.filetypes = filetypes;
            this.command = yield this.nvim.call('coc#util#get_listfile_command');
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.checkFileType(filetype))
                return false;
            let { shouldResolve } = require(path.join(baseDir, filetype));
            return yield shouldResolve(opt);
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { command, nvim } = this;
            let { bufnr, col } = opt;
            let { trimSameExts } = this.config;
            let fullpath = yield nvim.call('coc#util#get_fullpath', [bufnr]);
            let items = [];
            if (fullpath && command) {
                let dir = fs_1.findSourceDir(fullpath);
                let ext = path.extname(path.basename(fullpath));
                if (dir) {
                    let out = yield pify(exec)(command, {
                        cwd: dir
                    });
                    let files = out.split(/\r?\n/);
                    items = files.map(file => {
                        let ex = path.extname(path.basename(file));
                        let trim = trimSameExts.indexOf(ext) !== -1 && ex === ext;
                        let filepath = path.join(dir, file);
                        let word = path.relative(path.dirname(fullpath), filepath);
                        if (trim)
                            word = word.slice(0, -ext.length);
                        return {
                            word,
                            abbr: file,
                            menu: this.menu
                        };
                    });
                }
            }
            return {
                startcol: col - 1,
                items
            };
        });
    }
}
exports.default = Include;
//# sourceMappingURL=include.js.map