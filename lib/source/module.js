"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
const logger = require('../util/logger')('source-module');
const baseDir = path.join(__dirname, 'module_resolve');
class Module extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'module',
            shortcut: 'M',
            priority: 0,
            engross: 1,
            filetypes: []
        });
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let files = yield pify(fs.readdir)(baseDir);
            files = files.filter(f => /\.js$/.test(f));
            let filetypes = files.map(f => f.replace(/\.js$/, ''));
            this.config.filetypes = filetypes;
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
            let { bufnr, input, filetype } = opt;
            let { resolve } = require(path.join(baseDir, filetype));
            let words = yield resolve(opt);
            return {
                items: words.map(word => {
                    return {
                        word,
                        menu: this.menu
                    };
                })
            };
        });
    }
}
exports.default = Module;
//# sourceMappingURL=module.js.map