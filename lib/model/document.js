"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const config_1 = require("../config");
const chars_1 = require("./chars");
const fs_1 = require("../util/fs");
const logger = require('../util/logger')('model-document');
// wrapper class of TextDocument
class Document {
    constructor(textDocument, keywordOption) {
        this.textDocument = textDocument;
        this.keywordOption = keywordOption;
        this.isIgnored = false;
        let chars = this.chars = new chars_1.Chars(keywordOption);
        if (this.includeDash) {
            chars.addKeyword('-');
        }
        this.generate();
        this.gitCheck().catch(err => {
            // noop
        });
    }
    get includeDash() {
        let { languageId } = this.textDocument;
        return [
            'html',
            'wxml',
            'css',
            'less',
            'scss',
            'wxss'
        ].indexOf(languageId) != -1;
    }
    gitCheck() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let checkGit = config_1.getConfig('checkGit');
            if (!checkGit)
                return;
            let { uri } = this;
            if (!uri.startsWith('file://'))
                return;
            this.isIgnored = yield fs_1.isGitIgnored(uri.replace('file://', ''));
        });
    }
    get content() {
        return this.textDocument.getText();
    }
    get filetype() {
        return this.textDocument.languageId;
    }
    get uri() {
        return this.textDocument.uri;
    }
    get version() {
        return this.textDocument.version;
    }
    equalTo(doc) {
        return doc.uri == this.uri;
    }
    setKeywordOption(option) {
        this.chars = new chars_1.Chars(option);
    }
    applyEdits(edits) {
        return vscode_languageserver_types_1.TextDocument.applyEdits(this.textDocument, edits);
    }
    getOffset(lnum, col) {
        return this.textDocument.offsetAt({
            line: lnum - 1,
            character: col
        });
    }
    isWord(word) {
        return this.chars.isKeyword(word);
    }
    changeDocument(doc) {
        this.textDocument = doc;
        this.generate();
    }
    getMoreWords() {
        let res = [];
        let { words, chars } = this;
        if (!chars.isKeywordChar('-'))
            return res;
        for (let word of words) {
            word = word.replace(/^-+/, '');
            if (word.indexOf('-') !== -1) {
                let parts = word.split('-');
                for (let part of parts) {
                    if (part.length > 2
                        && res.indexOf(part) === -1
                        && words.indexOf(part) === -1) {
                        res.push(part);
                    }
                }
            }
        }
        return res;
    }
    generate() {
        let { content } = this;
        if (content.length == 0) {
            this.words = [];
        }
        else {
            this.words = this.chars.matchKeywords(content);
        }
    }
}
exports.default = Document;
//# sourceMappingURL=document.js.map