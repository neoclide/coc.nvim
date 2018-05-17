"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const chars_1 = require("./chars");
// const logger = require('../util/logger')('model-document')
class Doc {
    constructor(uri, filetype, version, content, keywordOption) {
        // this.doc = TextDocument.create(uri, filetype, version, content)
        this.uri = uri;
        this.filetype = filetype;
        this.content = content;
        this.version = version;
        let chars = this.chars = new chars_1.Chars(keywordOption);
        chars.addKeyword('_');
        chars.addKeyword('-');
    }
    // public applyEdits(edits: TextEdit[]):string {
    //   return TextDocument.applyEdits(this.doc, edits)
    // }
    // public setContent(content: string):void {
    //   this.content = content
    //   let version = this.version = this.version + 1
    //   this.doc = TextDocument.create(this.uri, this.filetype, version, content)
    // }
    isWord(word) {
        return this.chars.isKeyword(word);
    }
    getWords() {
        let { content, chars } = this;
        if (content.length == 0)
            return [];
        let words = chars.matchKeywords(content);
        for (let word of words) {
            for (let ch of ['-', '_']) {
                if (word.indexOf(ch) !== -1) {
                    let parts = word.split(ch).slice(0, -1);
                    for (let part of parts) {
                        if (words.indexOf(part) === -1) {
                            words.push(part);
                        }
                    }
                }
            }
        }
        return words;
    }
}
exports.default = Doc;
//# sourceMappingURL=document.js.map