"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const unique = require("array-unique");
class Doc {
    constructor(uri, filetype, version, content, keywordRegStr) {
        this.keywordsRegex = new RegExp(`${keywordRegStr}{3,}`, 'g');
        this.doc = vscode_languageserver_types_1.TextDocument.create(uri, filetype, version, content);
        this.content = content;
    }
    applyEdits(edits) {
        return vscode_languageserver_types_1.TextDocument.applyEdits(this.doc, edits);
    }
    getWords() {
        let { content } = this;
        let { keywordsRegex } = this;
        if (content.length == 0)
            return [];
        let words = content.match(keywordsRegex) || [];
        words = unique(words);
        for (let word of words) {
            let ms = word.match(/^(\w{3,})[\\-_]/);
            if (ms && words.indexOf(ms[0]) == -1) {
                words.unshift(ms[1]);
            }
        }
        return words;
    }
}
exports.default = Doc;
//# sourceMappingURL=document.js.map