"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const index_1 = require("../util/index");
// const logger = require('../util/logger')('source-omni')
class OmniSource extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'omni',
            shortcut: 'O',
            priority: 3,
            filetypes: []
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { filetype } = opt;
            if (!this.checkFileType(filetype))
                return false;
            let func = yield this.nvim.call('getbufvar', ['%', '&omnifunc']);
            opt.func = func;
            if (typeof func == 'string' && func.length != 0)
                return true;
            yield index_1.echoWarning(this.nvim, 'omnifunc option is empty, omni source skipped');
            return false;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { line, colnr, col, func } = opt;
            let { nvim } = this;
            if (['LanguageClient#complete'].indexOf('func') !== -1) {
                yield index_1.echoWarning(nvim, `omnifunc ${func} is broken, skipped!`);
                return null;
            }
            let startcol = yield nvim.call(func, [1, '']);
            startcol = Number(startcol);
            // invalid startcol
            if (isNaN(startcol) || startcol < 0 || startcol > colnr)
                return null;
            let text = line.slice(startcol, colnr);
            let words = yield nvim.call(func, [0, text]);
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