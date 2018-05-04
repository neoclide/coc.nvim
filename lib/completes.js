"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const complete_1 = require("./model/complete");
const buffer_1 = require("./source/buffer");
// TODO add dictionary & path
class Completes {
    constructor() {
        this.completes = [];
    }
    createComplete(opts) {
        // let {bufnr, line, col, input, filetype} = opts
        let { bufnr, lnum, col, input, filetype, word } = opts;
        let complete = new complete_1.default({
            bufnr: bufnr.toString(),
            line: lnum,
            word,
            col,
            input,
            filetype
        });
        let { id } = complete;
        let exist = this.completes.find(o => o.id === id);
        if (exist)
            return exist;
        if (this.completes.length > 10) {
            this.completes.shift();
        }
        this.completes.push(complete);
        return complete;
    }
    getSources(nvim, filetype) {
        let sources = config_1.getConfig('sources');
        let res = [];
        for (let s of sources) {
            if (s === 'buffer') {
                res.push(new buffer_1.default(nvim));
            }
        }
        return res;
    }
    // should be called when sources changed
    reset() {
        this.completes = [];
    }
}
exports.Completes = Completes;
exports.default = new Completes();
//# sourceMappingURL=completes.js.map