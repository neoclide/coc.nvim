"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const unique = require("array-unique");
const crypto = require("crypto");
const { createHash } = crypto;
class Buffer {
    constructor(bufnr, content, keywordRegStr) {
        this.bufnr = bufnr;
        this.content = content;
        this.keywordRegStr = keywordRegStr;
        this.bufnr = bufnr;
        this.content = content;
        this.keywordsRegex = new RegExp(`${keywordRegStr}{3,}`, 'g');
        this.keywordRegex = new RegExp(`^${keywordRegStr}+$`, 'g');
        this.generateWords();
        this.genHash(content);
    }
    isWord(word) {
        return this.keywordRegex.test(word);
    }
    generateWords() {
        let { content, keywordsRegex } = this;
        if (content.length == 0)
            return;
        let words = content.match(keywordsRegex) || [];
        words = unique(words);
        let arr = Array.from(words);
        for (let word of words) {
            let ms = word.match(/^(\w{3,})-/);
            if (ms && words.indexOf(ms[0]) === -1) {
                arr.unshift(ms[1]);
            }
            ms = word.match(/^(\w{3,})_/);
            if (ms && words.indexOf(ms[0]) === -1) {
                arr.unshift(ms[1]);
            }
        }
        this.words = words;
        this.moreWords = unique(arr);
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