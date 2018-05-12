"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const fs_1 = require("../util/fs");
const fs = require("fs");
const unique = require("array-unique");
const pify = require("pify");
const logger = require('../util/logger')('source-dictionary');
let dicts = {};
class Dictionary extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'dictionary',
            shortcut: 'D',
            priority: 1,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { input } = opt;
            if (input.length === 0)
                return false;
            let dictOption = yield this.nvim.call('getbufvar', ['%', '&dictionary']);
            dictOption = opt.dictOption = dictOption.trim();
            if (!dictOption)
                return false;
            return true;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            dicts = {};
            let dictOption = yield this.nvim.call('getbufvar', ['%', '&dictionary']);
            if (!dictOption)
                return;
            let files = dictOption.split(',');
            yield this.getWords(files);
            logger.info('dict refreshed');
        });
    }
    getWords(files) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (files.length == 0)
                return [];
            let arr = yield Promise.all(files.map(file => this.getDictWords(file)));
            return unique([].concat.apply([], arr));
        });
    }
    getDictWords(file) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!file)
                return [];
            let words = dicts[file] || null;
            if (words && words.length)
                return words;
            let stat = yield fs_1.statAsync(file);
            if (!stat || !stat.isFile())
                return [];
            try {
                let content = yield pify(fs.readFile)(file, 'utf8');
                words = content.split('\n');
            }
            catch (e) {
                logger.error(`Can't read file: ${file}`);
            }
            dicts[file] = words;
            return words;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, input, filetype, dictOption } = opt;
            let words = [];
            if (dictOption) {
                let files = dictOption.split(',');
                words = yield this.getWords(files);
                words = this.filterWords(words, opt);
            }
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
exports.default = Dictionary;
//# sourceMappingURL=dictionary.js.map