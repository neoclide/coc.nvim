"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const workspace_1 = require("../workspace");
const logger = require('../util/logger')('source-around');
class Around extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'around',
            shortcut: 'A',
            priority: 1,
            firstMatch: true,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { input } = opt;
            if (input.length === 0)
                return false;
            return true;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr } = opt;
            let document = workspace_1.default.getDocument(bufnr);
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
        });
    }
}
exports.default = Around;
//# sourceMappingURL=around.js.map