"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("../config");
class Input {
    constructor(nvim, search, linenr, startcol) {
        this.nvim = nvim;
        this.linenr = linenr;
        this.startcol = startcol;
        this.search = search;
    }
    highlight() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let enabled = config_1.getConfig('incrementHightlight');
            if (!enabled)
                return;
            yield this.clear();
            if (this.search.length) {
                let plist = this.getMatchPos();
                this.match = yield this.nvim.call('matchaddpos', ['CocChars', plist, 99]);
            }
        });
    }
    removeCharactor() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { search } = this;
            let l = search.length;
            if (l == 0)
                return true;
            this.search = this.search.slice(0, -1);
            yield this.highlight();
            return false;
        });
    }
    addCharactor(c) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.search = this.search + c;
            yield this.highlight();
        });
    }
    getMatchPos() {
        let { startcol, search, linenr } = this;
        let range = Array.apply(null, Array(search.length)).map((_, i) => i);
        return range.map(p => {
            return [linenr, startcol + p + 1];
        });
    }
    clear() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this.match) {
                yield this.nvim.command(`silent! call matchdelete(${this.match})`);
                this.match = null;
            }
        });
    }
}
exports.default = Input;
//# sourceMappingURL=input.js.map