"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const buffer_1 = require("./model/buffer");
const config_1 = require("./config");
const filter_1 = require("./util/filter");
const sorter_1 = require("./util/sorter");
const unique = require("array-unique");
class Buffers {
    constructor() {
        this.buffers = [];
    }
    addBuffer(bufnr, content) {
        let buf = this.buffers.find(buf => buf.bufnr === bufnr);
        if (buf) {
            buf.setContent(content);
        }
        else {
            this.buffers.push(new buffer_1.default(bufnr, content));
        }
    }
    removeBuffer(bufnr) {
        let idx = this.buffers.findIndex(o => o.bufnr === bufnr);
        if (idx !== -1) {
            this.buffers.splice(idx, 1);
        }
    }
    getWords(bufnr, input) {
        let fuzzyMatch = config_1.getConfig('fuzzyMatch');
        let words = [];
        for (let buf of this.buffers) {
            let arr = bufnr === buf.bufnr ? buf.moreWords : buf.words;
            words = words.concat(arr);
        }
        words = unique(words);
        words = fuzzyMatch ? filter_1.filterFuzzy(words, input) : filter_1.filterWord(words, input);
        words = sorter_1.fuzzySort(words, input);
        return words.slice(0, 50);
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