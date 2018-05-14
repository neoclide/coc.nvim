"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require("crypto");
const chars_1 = require("./chars");
const { createHash } = crypto;
// const logger = require('../util/logger')('model-buffer')
class Buffer {
    constructor(bufnr, content, keywordOption) {
        this.bufnr = bufnr;
        this.content = content;
        this.keywordOption = keywordOption;
        this.bufnr = bufnr;
        this.content = content;
        this.chars = new chars_1.Chars(keywordOption);
        this.generate();
    }
    isWord(word) {
        return this.chars.isKeyword(word);
    }
    generate() {
        let { content } = this;
        if (content.length == 0)
            return;
        this.words = this.chars.matchKeywords(content);
        this.hash = createHash('md5').update(content).digest('hex');
    }
    setKeywordOption(option) {
        this.chars = new chars_1.Chars(option);
        this.generate();
    }
    setContent(content) {
        this.content = content;
        this.generate();
    }
}
exports.default = Buffer;
//# sourceMappingURL=buffer.js.map