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
class VimSource extends source_1.default {
    shouldComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            let name = `complete#source#${this.name}#should_complete`;
            let exists = yield this.nvim.call('exists', [`*${name}`]);
            if (exists == 1) {
                let res = yield this.nvim.call(name, [opt]);
                return res === 1;
            }
            return true;
        });
    }
    doComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.nvim.call('complete#complete_source', [this.name, opt]);
            let { id } = opt;
            let res = yield remote_store_1.default.getResult(id, this.name);
            return res;
        });
    }
}
exports.default = VimSource;
//# sourceMappingURL=source-vim.js.map