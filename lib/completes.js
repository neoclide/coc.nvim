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
const config_1 = require("./config");
const complete_1 = require("./model/complete");
const logger_1 = require("./util/logger");
const natives_1 = require("./natives");
const remotes_1 = require("./remotes");
class Completes {
    constructor() {
        this.completes = [];
    }
    createComplete(opts) {
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
        return __awaiter(this, void 0, void 0, function* () {
            let source_names = config_1.getConfig('sources');
            let res = [];
            for (let name of source_names) {
                let source;
                if (natives_1.default.has(name)) {
                    source = yield natives_1.default.getSource(nvim, name);
                }
                else if (remotes_1.default.has(name)) {
                    source = yield remotes_1.default.getSource(nvim, name);
                }
                else {
                    logger_1.logger.error(`Source ${name} not found`);
                }
                if (source) {
                    res.push(source);
                }
                else {
                    logger_1.logger.error(`Source ${name} can not created`);
                }
            }
            logger_1.logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`);
            return res;
        });
    }
    // should be called when sources changed
    reset() {
        this.completes = [];
    }
}
exports.Completes = Completes;
exports.default = new Completes();
//# sourceMappingURL=completes.js.map