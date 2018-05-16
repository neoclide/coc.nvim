"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const buffers_1 = require("../buffers");
const index_1 = require("../util/index");
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
            let uri = `buffer://${bufnr}`;
            let { nvim } = this;
            let count = yield nvim.call('nvim_buf_line_count', [bufnr]);
            if (count > 2000) {
                yield index_1.echoWarning(nvim, `File too big, loading file from disk`);
            }
            let keywordOption = yield nvim.call('getbufvar', [bufnr, '&iskeyword']);
            let content = yield buffers_1.default.loadBufferContent(nvim, bufnr, 300);
            let document = buffers_1.default.createDocument(uri, filetype, content, keywordOption);
            let words = document.getWords();
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