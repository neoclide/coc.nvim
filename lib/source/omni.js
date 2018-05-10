"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const index_1 = require("../util/index");
class OmniSource extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'omni',
            shortcut: 'O',
            priority: 3,
            filetypes: []
        });
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let res = yield this.nvim.getVar('complete_omni_filetypes');
            if (Array.isArray(res)) {
                this.filetypes = res;
            }
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.filetypes)
                return false;
            if (this.filetypes.indexOf(filetype) === -1)
                return false;
            let func = yield this.nvim.call('getbufvar', ['%', '&omnifunc']);
            return typeof func == 'string' && func.length != 0;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { line, colnr, col } = opt;
            let func = yield this.nvim.call('getbufvar', ['%', '&omnifunc']);
            if (['LanguageClient#complete'].indexOf('func') !== -1) {
                index_1.echoWarning(this.nvim, `omnifunc ${func} is broken, skipped!`);
                return { items: [] };
            }
            let startcol = yield this.nvim.call(func, [1, '']);
            startcol = Number(startcol);
            // invalid startcol
            if (isNaN(startcol) || startcol < 0 || startcol > colnr)
                return null;
            let text = line.slice(startcol, colnr);
            let words = yield this.nvim.call(func, [0, text]);
            if (words.hasOwnProperty('words')) {
                words = words.words;
            }
            let res = {
                items: this.convertToItems(words)
            };
            if (startcol !== col && words.length != 0) {
                res.startcol = startcol;
                res.engross = true;
            }
            return res;
        });
    }
}
exports.default = OmniSource;
//# sourceMappingURL=omni.js.map