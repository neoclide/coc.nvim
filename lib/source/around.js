"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const buffers_1 = require("../buffers");
const logger = require('../util/logger')('source-around');
class Around extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'around',
            shortcut: 'A',
            priority: 2,
            firstMatch: true,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { input } = opt;
            if (input.length === 0)
                return false;
            return true;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, filetype } = opt;
            let { nvim } = this;
            let count = yield nvim.call('nvim_buf_line_count', [bufnr]);
            let keywordOption = yield nvim.call('getbufvar', [bufnr, '&iskeyword']);
            let words = buffers_1.default.document.getWords();
            words = this.filterWords(words, opt);
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
exports.default = Around;
//# sourceMappingURL=around.js.map