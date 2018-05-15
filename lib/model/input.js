"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("../config");
class Input {
    constructor(nvim, input, word, linenr, startcol) {
        let positions = [];
        let index = 0;
        let icase = !/[A-Z]/.test(input);
        for (let i = 0, l = input.length; i < l; i++) {
            let ch = input[i];
            while (index < word.length) {
                if (this.caseEqual(word[index], ch, icase)) {
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
    caseEqual(a, b, icase) {
        if (icase) {
            return a.toLowerCase() == b.toLowerCase();
        }
        return a === b;
    }
    highlight() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.clear();
            let plist = this.getMatchPos();
            let completeOpt = config_1.getConfig('completeOpt');
            if (/noinsert/.test(completeOpt))
                return;
            if (plist.length) {
                this.match = yield this.nvim.call('matchaddpos', ['CocChars', plist, 99]);
            }
        });
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
                yield this.highlight();
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
            yield this.highlight();
        });
    }
    getMatchPos() {
        let { startcol, positions, linenr } = this;
        return positions.map(p => {
            return [linenr, startcol + p + 1];
        });
    }
    get isValid() {
        return this.input.length === this.positions.length;
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