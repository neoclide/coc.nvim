"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const buffers_1 = require("../buffers");
class Buffer extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'buffer',
            shortcut: 'B',
            priority: 1,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            let { input } = opt;
            if (input.length === 0)
                return false;
            return true;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield buffers_1.default.refresh(this.nvim);
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { bufnr, input } = opt;
            let words = buffers_1.default.getWords(bufnr);
            return {
                items: words.map(word => {
                    return {
                        word,
                        menu: this.menu
                    };
                })
            };
        });
    }
}
exports.default = Buffer;
//# sourceMappingURL=buffer.js.map