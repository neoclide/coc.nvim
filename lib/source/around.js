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
            let { bufnr, input, filetype } = opt;
            let uri = `buffer://${bufnr}`;
            let buffer = yield this.nvim.buffer;
            let keywordOption = yield buffer.getOption('iskeyword');
            let lines = yield buffer.lines;
            let content = lines.join('\n');
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