"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const remote_store_1 = require("../remote-store");
const config_1 = require("../config");
const source_1 = require("./source");
const filter_1 = require("../util/filter");
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
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { colnr, col, id, input } = opt;
            let startcol = yield this.callOptinalFunc('get_startcol', [opt]);
            if (startcol) {
                startcol = Number(startcol);
                // invalid startcol
                if (isNaN(startcol) || startcol < 0 || startcol > colnr)
                    return null;
                if (startcol !== col) {
                    opt = Object.assign({}, opt, { col: startcol });
                }
            }
            yield this.nvim.call('coc#remote#do_complete', [this.name, opt]);
            let items = yield remote_store_1.default.getResult(id, this.name);
            let filter = config_1.getConfig('filter');
            for (let item of items) {
                if (!item.kind) {
                    delete item.dup;
                    delete item.icase;
                }
                if (item.menu && !item.info) {
                    item.info = item.menu;
                }
                item.menu = this.menu;
            }
            if (items.length) {
                if (filter === 'word') {
                    items = filter_1.filterItemWord(items, input);
                }
                else {
                    items = filter_1.filterItemFuzzy(items, input);
                }
            }
            let res = { items };
            if (startcol !== col && items.length != 0) {
                res.startcol = startcol;
                res.engross = true;
            }
            return res;
        });
    }
}
exports.default = VimSource;
//# sourceMappingURL=source-vim.js.map