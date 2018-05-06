"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const unique = require("array-unique");
const crypto = require("crypto");
const { createHash } = crypto;
class Buffer {
    constructor(bufnr, content, keywordRe) {
        this.bufnr = bufnr;
        this.content = content;
        this.keywordRe = keywordRe;
        this.bufnr = bufnr;
        this.content = content;
        this.keywordRe = keywordRe;
        this.generateWords();
        this.genHash(content);
    }
    generateWords() {
        let { content, keywordRe } = this;
        if (content.length == 0)
            return;
        // let regex: RegExp = getConfig('keywordsRegex') as RegExp
        let words = content.match(keywordRe) || [];
        words = words.filter(w => w.length > 1);
        words = unique(words);
        let arr = Array.from(words);
        for (let word of words) {
            let ms = word.match(/^(\w{2,})-/);
            if (ms && words.indexOf(ms[0]) === -1) {
                arr.unshift(ms[1]);
            }
            ms = word.match(/^(\w{2,})_/);
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