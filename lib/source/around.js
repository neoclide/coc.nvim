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
const source_1 = require("../model/source");
const buffers_1 = require("../buffers");
class Around extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'around',
            shortcut: 'A'
        });
    }
    shouldComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            let { input } = opt;
            if (input.length === 0)
                return false;
            return true;
        });
    }
    doComplete(opt) {
        return __awaiter(this, void 0, void 0, function* () {
            let { bufnr, input, filetype } = opt;
            let filepath = yield this.nvim.call('expand', ['%:p']);
            let uri = `file://${filepath}`;
            let buffer = yield this.nvim.buffer;
            let keywordOption = yield buffer.getOption('iskeyword');
            let lines = yield buffer.lines;
            let content = lines.join('\n');
            let document = buffers_1.default.createDocument(uri, filetype, content, keywordOption);
            let words = document.getWords();
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
exports.default = Around;
//# sourceMappingURL=around.js.map