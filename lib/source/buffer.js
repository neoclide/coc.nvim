"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const source_1 = tslib_1.__importDefault(require("../model/source"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('source-buffer');
class Buffer extends source_1.default {
    constructor() {
        super({
            name: 'buffer',
            filepath: __filename
        });
    }
    get ignoreGitignore() {
        return this.getConfig('ignoreGitignore', true);
    }
    getWords(bufnr) {
        let { ignoreGitignore } = this;
        let words = [];
        workspace_1.default.documents.forEach(document => {
            if (document.bufnr == bufnr)
                return;
            if (ignoreGitignore && document.isIgnored)
                return;
            for (let word of document.words) {
                if (words.indexOf(word) == -1) {
                    words.push(word);
                }
            }
        });
        return words;
    }
    async doComplete(opt) {
        let { bufnr, input } = opt;
        if (input.length == 0)
            return null;
        let words = this.getWords(bufnr);
        words = this.filterWords(words, opt);
        return {
            items: words.map(word => {
                return {
                    word,
                    menu: this.menu
                };
            })
        };
    }
}
exports.default = Buffer;
function regist(sourceMap) {
    sourceMap.set('buffer', new Buffer());
    return vscode_languageserver_protocol_1.Disposable.create(() => {
        sourceMap.delete('buffer');
    });
}
exports.regist = regist;
//# sourceMappingURL=buffer.js.map