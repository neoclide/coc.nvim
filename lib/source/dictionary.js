"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const logger_1 = require("../util/logger");
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
        this.dicts = {};
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { input } = opt;
            if (input.length === 0)
                return false;
            return true;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.dicts = {};
        });
    }
    getWords(dicts) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (dicts.length == 0)
                return [];
            let arr = yield Promise.all(dicts.map(dict => this.getDictWords(dict)));
            return unique([].concat.apply([], arr));
        });
    }
    getDictWords(file) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let res = this.dicts[file];
            if (res)
                return res;
            let words = [];
            try {
                let content = yield pify(fs.readFile)(file, 'utf8');
                words = content.split('\n');
            }
            catch (e) {
                logger_1.logger.error(`Can't read file: ${file}`);
            }
            this.dicts[file] = words;
            return words;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, input, filetype } = opt;
            let dictOption = yield this.nvim.call('getbufvar', [Number(bufnr), '&dictionary']);
            let dicts = dictOption.split(',');
            let words = yield this.getWords(dicts);
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