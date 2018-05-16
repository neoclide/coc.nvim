"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chars_1 = require("./chars");
const logger = require('../util/logger')('model-buffer');
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
        // TODO for performance, this have to be implemented in C code
        this.words = this.chars.matchKeywords(content);
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