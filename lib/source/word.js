"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = require("../util/fs");
const source_1 = require("../model/source");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
const logger = require('../util/logger')('source-word');
let words = null;
let file = path.resolve(__dirname, '../../data/10k.txt');
class Word extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'word',
            shortcut: '10k',
            priority: 0,
            filetypes: [],
            only: true,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            let stat = yield fs_1.statAsync(file);
            if (!stat || !stat.isFile())
                return false;
            let { input } = opt;
            if (input.length === 0)
                return false;
            return true;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!words) {
                let content = yield pify(fs.readFile)(file, 'utf8');
                words = content.split(/\n/);
            }
            let list = this.filterWords(words, opt);
            return {
                items: list.map(word => {
                    return {
                        word,
                        menu: this.menu
                    };
                })
            };
        });
    }
}
exports.default = Word;
//# sourceMappingURL=word.js.map