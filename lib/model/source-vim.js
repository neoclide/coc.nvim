"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const remote_store_1 = require("../remote-store");
const config_1 = require("../config");
const source_1 = require("./source");
const filter_1 = require("../util/filter");
const index_1 = require("../util/index");
class VimSource extends source_1.default {
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            let name = `complete#source#${this.name}#should_complete`;
            let exists = yield this.nvim.call('exists', [`*${name}`]);
            if (exists == 1) {
                let res = 0;
                try {
                    res = yield this.nvim.call(name, [opt]);
                }
                catch (e) {
                    yield this.echoError(e.message);
                    return false;
                }
                return res == 1;
            }
            return true;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let name = `complete#source#${this.name}#refresh`;
            let exists = yield this.nvim.call('exists', [`*${name}`]);
            if (exists == 1) {
                try {
                    yield this.nvim.call(name, []);
                }
                catch (e) {
                    yield this.echoError(e.message);
                }
            }
            else {
                yield index_1.echoWarning(this.nvim, `No refresh method defiend for ${name}`);
            }
        });
    }
    echoError(str) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield index_1.echoErr(this.nvim, `Vim error from source ${this.name}: ${str}`);
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { colnr, col, id, input } = opt;
            let fn = `complete#source#${this.name}#get_startcol`;
            let exists = yield this.nvim.call('exists', [`*${fn}`]);
            let startcol = null;
            if (exists == 1) {
                try {
                    startcol = yield this.nvim.call(fn, [opt]);
                    startcol = Number(startcol);
                    if (isNaN(startcol) || startcol < 0 || startcol > colnr)
                        return null;
                }
                catch (e) {
                    yield this.echoError(e.message);
                    return null;
                }
            }
            if (startcol && startcol !== col) {
                opt = Object.assign({}, opt, { col: startcol });
            }
            yield this.nvim.call('complete#remote#do_complete', [this.name, opt]);
            let items = yield remote_store_1.default.getResult(id, this.name);
            let filter = config_1.getConfig('filter');
            for (let item of items) {
                // not use these
                delete item.dup;
                delete item.icase;
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
            if (startcol !== col) {
                res.startcol = startcol;
                res.engross = items.length != 0;
            }
            return res;
        });
    }
}
exports.default = VimSource;
//# sourceMappingURL=source-vim.js.map