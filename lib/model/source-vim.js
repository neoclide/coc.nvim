"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fuzzy_1 = require("../util/fuzzy");
const string_1 = require("../util/string");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const source_1 = tslib_1.__importDefault(require("./source"));
const logger = require('../util/logger')('model-source-vim');
class VimSource extends source_1.default {
    async callOptinalFunc(fname, args) {
        let exists = this.optionalFns.indexOf(fname) !== -1;
        if (!exists)
            return null;
        let name = `coc#source#${this.name}#${fname}`;
        let res;
        try {
            res = await this.nvim.call(name, args);
        }
        catch (e) {
            workspace_1.default.showMessage(`Vim error from source ${this.name}: ${e.message}`, 'error');
            return null;
        }
        return res;
    }
    async shouldComplete(opt) {
        let shouldRun = await super.shouldComplete(opt);
        if (!shouldRun)
            return false;
        if (this.optionalFns.indexOf('should_complete') === -1)
            return true;
        let res = await this.callOptinalFunc('should_complete', [opt]);
        return !!res;
    }
    async refresh() {
        await this.callOptinalFunc('refresh', []);
    }
    async onCompleteDone(item, opt) {
        await super.onCompleteDone(item, opt);
        if (this.optionalFns.indexOf('on_complete') === -1)
            return;
        this.callOptinalFunc('on_complete', [item]); // tslint:disable-line
    }
    onEnter(bufnr) {
        if (this.optionalFns.indexOf('on_enter') === -1)
            return;
        let doc = workspace_1.default.getDocument(bufnr);
        if (!doc)
            return;
        let { filetypes } = this;
        if (filetypes && filetypes.indexOf(doc.filetype) == -1)
            return;
        this.callOptinalFunc('on_enter', [{
                bufnr,
                uri: doc.uri,
                languageId: doc.filetype
            }]); // tslint:disable-line
    }
    async doComplete(opt, token) {
        let { col, input, line, colnr } = opt;
        let startcol = await this.callOptinalFunc('get_startcol', [opt]);
        if (token.isCancellationRequested)
            return;
        if (startcol) {
            if (startcol < 0)
                return null;
            startcol = Number(startcol);
            // invalid startcol
            if (isNaN(startcol) || startcol < 0)
                startcol = col;
            if (startcol !== col) {
                input = string_1.byteSlice(line, startcol, colnr - 1);
                opt = Object.assign({}, opt, {
                    col: startcol,
                    changed: col - startcol,
                    input
                });
            }
        }
        let items = await this.nvim.callAsync('coc#util#do_complete', [this.name, opt]);
        if (!items || items.length == 0 || token.isCancellationRequested)
            return null;
        if (this.firstMatch && input.length) {
            let ch = input[0];
            items = items.filter(item => {
                let cfirst = item.filterText ? item.filterText[0] : item.word[0];
                return fuzzy_1.fuzzyChar(ch, cfirst);
            });
        }
        for (let item of items) {
            let menu = item.menu ? item.menu + ' ' : '';
            item.menu = `${menu}${this.menu}`;
            item.isSnippet = this.isSnippet;
            delete item.user_data;
        }
        let res = { items };
        res.startcol = startcol;
        return res;
    }
}
exports.default = VimSource;
//# sourceMappingURL=source-vim.js.map