"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const remote_store_1 = require("../remote-store");
const config_1 = require("../config");
const source_1 = require("./source");
const filter_1 = require("../util/filter");
const index_1 = require("../util/index");
class VimSource extends source_1.default {
    shouldComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
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
        return __awaiter(this, void 0, void 0, function* () {
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
        return __awaiter(this, void 0, void 0, function* () {
            yield index_1.echoErr(this.nvim, `Vim error from source ${this.name}: ${str}`);
        });
    }
    doComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            let fn = `complete#source#${this.name}#get_offset`;
            let exists = yield this.nvim.call('exists', [`*${fn}`]);
            let offsets = null;
            if (exists == 1) {
                try {
                    offsets = yield this.nvim.call(fn, [opt]);
                }
                catch (e) {
                    yield this.echoError(e.message);
                    return null;
                }
            }
            yield this.nvim.call('complete#remote#do_complete', [this.name, opt]);
            let { id, input } = opt;
            let items = yield remote_store_1.default.getResult(id, this.name);
            let filter = config_1.getConfig('filter');
            for (let item of items) {
                // not use these
                delete item.dup;
                delete item.icase;
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
            if (offsets) {
                res.offsetLeft = offsets.offsetLeft || 0;
                res.offsetRight = offsets.offsetRight || 0;
            }
            return res;
        });
    }
}
exports.default = VimSource;
//# sourceMappingURL=source-vim.js.map