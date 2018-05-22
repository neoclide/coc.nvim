"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const remote_store_1 = require("../remote-store");
const source_1 = require("./source");
const fuzzy_1 = require("../util/fuzzy");
const index_1 = require("../util/index");
const logger = require('../util/logger')('model-source-vim'); // tslint:disable-line
class VimSource extends source_1.default {
    echoError(str) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield index_1.echoErr(this.nvim, `Vim error from source ${this.name}: ${str}`);
        });
    }
    callOptinalFunc(fname, args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let exists = this.optionalFns.indexOf(fname) !== -1;
            if (!exists)
                return null;
            let name = `coc#source#${this.name}#${fname}`;
            let res;
            try {
                res = yield this.nvim.call(name, args);
            }
            catch (e) {
                yield this.echoError(e.message);
                return null;
            }
            return res;
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            if (this.optionalFns.indexOf('should_complete') === -1)
                return true;
            let res = yield this.callOptinalFunc('should_complete', [opt]);
            return !!res;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.callOptinalFunc('refresh', []);
        });
    }
    onCompleteDone(item) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (this.optionalFns.indexOf('on_complete') === -1)
                return;
            yield this.callOptinalFunc('on_complete', [item]);
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { col, id, input } = opt;
            let startcol = yield this.callOptinalFunc('get_startcol', [opt]);
            if (startcol) {
                if (startcol < 0)
                    return null;
                startcol = Number(startcol);
                // invalid startcol
                if (isNaN(startcol) || startcol < 0)
                    startcol = col;
                if (startcol !== col) {
                    opt = Object.assign({}, opt, { col: startcol });
                }
            }
            yield this.nvim.call('coc#remote#do_complete', [this.name, opt]);
            let items = yield remote_store_1.default.getResult(id, this.name);
            if (this.firstMatch && input.length) {
                let ch = input[0];
                items = items.filter(item => {
                    let cfirst = item.abbr ? item.abbr[0] : item.word[0];
                    return fuzzy_1.fuzzyChar(ch, cfirst);
                });
            }
            for (let item of items) {
                delete item.dup;
                delete item.icase;
                let menu = item.menu ? item.menu + ' ' : '';
                item.menu = `${menu}${this.menu}`;
            }
            let res = { items };
            if (startcol && startcol !== col && items.length != 0) {
                res.startcol = startcol;
                res.engross = true;
            }
            return res;
        });
    }
}
exports.default = VimSource;
//# sourceMappingURL=source-vim.js.map