"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config");
const unique = require("array-unique");
const crypto = require("crypto");
const { createHash } = crypto;
class Buffer {
    constructor(bufnr, content) {
        this.bufnr = bufnr;
        this.content = content;
        this.bufnr = bufnr;
        this.content = content;
        this.generateWords();
        this.genHash(content);
    }
    generateWords() {
        let { content } = this;
        if (content.length == 0)
            return;
        let regex = config_1.getConfig('keywordsRegex');
        let words = content.match(regex) || [];
        words = words.filter(w => w.length > 1);
        words = unique(words);
        let arr = Array.from(words);
        for (let word of words) {
            let ms = word.match(/^(\w+)-/);
            if (ms && words.indexOf(ms[0]) === -1) {
                arr.unshift(ms[1]);
            }
            ms = word.match(/^(\w+)_/);
            if (ms && words.indexOf(ms[0]) === -1) {
                arr.unshift(ms[1]);
            }
        }
        this.words = words;
        this.moreWords = arr;
    }
    genHash(content) {
        this.hash = createHash('md5').update(content).digest('hex');
    }
    setContent(content) {
        this.content = content;
        this.generateWords();
        this.genHash(content);
    }
}
exports.default = Buffer;
//# sourceMappingURL=buffer.js.map