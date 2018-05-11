"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const logger = require('./util/logger')('input');
class Input {
    constructor(nvim, linenr, input, word, startcol) {
        let positions = [];
        let index = 0;
        for (let i = 0, l = input.length; i < l; i++) {
            let ch = input[i];
            while (index < word.length) {
                if (word[index].toLowerCase() == ch.toLowerCase()) {
                    positions.push(index);
                    break;
                }
                index++;
            }
        }
        this.linenr = linenr;
        this.word = word;
        this.nvim = nvim;
        this.startcol = startcol;
        this.input = input;
        this.positions = positions;
    }
    removeCharactor() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { word, input } = this;
            if (!input.length)
                return true;
            let { positions } = this;
            if (positions.length) {
                positions.pop();
                this.input = this.input.slice(0, -1);
                this.word = word.slice(0, -1);
                let plist = this.getMatchPos();
                yield this.clear();
                if (plist.length) {
                    this.match = yield this.nvim.call('matchaddpos', ['CompleteChars', plist]);
                }
            }
            if (positions.length == 0)
                return true;
        });
    }
    addCharactor(c) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.input = this.input + c;
            this.word = this.word + c;
            this.positions.push(this.word.length - 1);
            let plist = this.getMatchPos();
            yield this.clear();
            logger.debug(JSON.stringify(plist));
            this.match = yield this.nvim.call('matchaddpos', ['CompleteChars', plist]);
        });
    }
    getMatchPos() {
        let { startcol, positions, linenr } = this;
        return positions.map(p => {
            return [linenr, startcol + p + 1];
        });
    }
    clear() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this.match) {
                yield this.nvim.call('matchdelete', [this.match]);
                this.match = null;
            }
        });
    }
}
exports.default = Input;
//# sourceMappingURL=input.js.map