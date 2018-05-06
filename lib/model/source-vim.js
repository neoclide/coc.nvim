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
const source_1 = require("./source");
const filter_1 = require("../util/filter");
class VimSource extends source_1.default {
    shouldComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            let name = `complete#source#${this.name}#should_complete`;
            let exists = yield this.nvim.call('exists', [`*${name}`]);
            if (exists == 1) {
                let res = yield this.nvim.call(name, [opt]);
                return res == 1;
            }
            return true;
        });
    }
    doComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            let fn = `complete#source#${this.name}#get_offset`;
            let exists = yield this.nvim.call('exists', [`*${fn}`]);
            let offsets = null;
            if (exists == 1) {
                offsets = yield this.nvim.call(fn, [opt]);
            }
            yield this.nvim.call('complete#remote#do_complete', [this.name, opt]);
            let { id, input } = opt;
            let items = yield remote_store_1.default.getResult(id, this.name);
            let { filter } = this;
            for (let item of items) {
                item.menu = this.menu;
            }
            if (filter === 'fuzzy') {
                items = filter_1.filterItemFuzzy(items, input);
            }
            else if (filter === 'word') {
                items = filter_1.filterItemWord(items, input);
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