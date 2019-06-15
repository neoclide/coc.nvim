"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const source_1 = tslib_1.__importDefault(require("../model/source"));
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('source-around');
class Around extends source_1.default {
    constructor() {
        super({
            name: 'around',
            filepath: __filename
        });
    }
    async doComplete(opt) {
        let { bufnr, input } = opt;
        if (input.length === 0)
            return null;
        let document = workspace_1.default.getDocument(bufnr);
        if (!document)
            return null;
        let words = document.words;
        let moreWords = document.getMoreWords();
        words.push(...moreWords);
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
exports.default = Around;
function regist(sourceMap) {
    sourceMap.set('around', new Around());
    return vscode_languageserver_protocol_1.Disposable.create(() => {
        sourceMap.delete('around');
    });
}
exports.regist = regist;
//# sourceMappingURL=around.js.map