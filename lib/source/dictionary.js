"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const logger_1 = require("../util/logger");
const fs_1 = require("../util/fs");
const fs = require("fs");
const unique = require("array-unique");
const pify = require("pify");
class Dictionary extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'dictionary',
            shortcut: 'D',
            priority: 1,
        });
        this.dicts = null;
        this.dictOption = '';
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { input, bufnr } = opt;
            if (input.length === 0)
                return false;
            let dictOption = yield this.nvim.call('getbufvar', [Number(bufnr), '&dictionary']);
            dictOption = this.dictOption = dictOption.trim();
            if (!dictOption)
                return false;
            return true;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.dicts = null;
            let dictOption = yield this.nvim.call('getbufvar', ['%', '&dictionary']);
            if (!dictOption)
                return;
            let files = dictOption.split(',');
            yield this.getWords(files);
            logger_1.logger.debug('dict refreshed');
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
            let { dicts } = this;
            let words = dicts ? dicts[file] : [];
            if (words)
                return words;
            let stat = yield fs_1.statAsync(file);
            if (!stat || !stat.isFile())
                return [];
            try {
                let content = yield pify(fs.readFile)(file, 'utf8');
                words = content.split('\n');
            }
            catch (e) {
                logger_1.logger.error(`Can't read file: ${file}`);
            }
            this.dicts = this.dicts || {};
            this.dicts[file] = words;
            return words;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, input, filetype } = opt;
            let { dictOption } = this;
            let words = [];
            if (dictOption) {
                let dicts = dictOption.split(',');
                words = yield this.getWords(dicts);
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