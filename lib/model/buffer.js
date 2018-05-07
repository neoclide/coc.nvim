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
        this.keywordRegex = new RegExp(`^${keywordRegStr}+$`);
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
        this.words = unique(words);
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