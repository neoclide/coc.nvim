"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const buffer_1 = require("./model/buffer");
const index_1 = require("./util/index");
const unique = require("array-unique");
class Buffers {
    constructor() {
        this.buffers = [];
    }
    addBuffer(bufnr, content, keywordOption) {
        let buf = this.buffers.find(buf => buf.bufnr === bufnr);
        if (buf) {
            buf.setContent(content);
        }
        else {
            let keywordRe = index_1.getKeywordsRegEx(keywordOption);
            this.buffers.push(new buffer_1.default(bufnr, content, keywordRe));
        }
    }
    removeBuffer(bufnr) {
        let idx = this.buffers.findIndex(o => o.bufnr === bufnr);
        if (idx !== -1) {
            this.buffers.splice(idx, 1);
        }
    }
    getWords(bufnr) {
        let words = [];
        for (let buf of this.buffers) {
            let arr = bufnr === buf.bufnr ? buf.moreWords : buf.words;
            words = words.concat(arr);
        }
        return unique(words);
    }
    getBuffer(bufnr) {
        let buf = this.buffers.find(o => o.bufnr == bufnr);
        return buf || null;
    }
}
exports.Buffers = Buffers;
const buffers = new Buffers();
exports.default = buffers;
//# sourceMappingURL=buffers.js.map