"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const chars_1 = require("./chars");
const logger = require('../util/logger')('model-document');
class Doc {
    constructor(uri, filetype, version, content, keywordOption) {
        this.uri = uri;
        this.filetype = filetype;
        this.content = content;
        this.version = version;
        let chars = this.chars = new chars_1.Chars(keywordOption);
        chars.addKeyword('_');
        chars.addKeyword('-');
        this.doc = vscode_languageserver_types_1.TextDocument.create(uri, filetype, version, content);
    }
    applyEdits(edits) {
        return vscode_languageserver_types_1.TextDocument.applyEdits(this.doc, edits);
    }
    getOffset(lnum, col) {
        return this.doc.offsetAt({
            line: lnum - 1,
            character: col
        });
    }
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
                        if (part.length > 2 && words.indexOf(part) === -1) {
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