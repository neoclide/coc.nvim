"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("./config");
const complete_1 = require("./model/complete");
const logger_1 = require("./util/logger");
const natives_1 = require("./natives");
const remotes_1 = require("./remotes");
class Completes {
    constructor() {
        this.complete = null;
    }
    newComplete(opts) {
        let { bufnr, lnum, line, col, colnr, input, filetype, word } = opts;
        let complete = new complete_1.default({
            bufnr: bufnr.toString(),
            linenr: lnum,
            line,
            word,
            col,
            colnr,
            input,
            filetype
        });
        return complete;
    }
    createComplete(opts) {
        let complete = this.newComplete(opts);
        this.complete = complete;
        return complete;
    }
    getComplete(opts) {
        if (!this.complete)
            return null;
        let complete = this.newComplete(opts);
        return this.complete.resuable(complete) ? this.complete : null;
    }
    getSources(nvim, filetype) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let source_names = config_1.getConfig('sources');
            let disabled = config_1.getConfig('disabled');
            let res = [];
            let names = natives_1.default.names;
            logger_1.logger.debug(`Disabled sources:${disabled}`);
            names = names.concat(remotes_1.default.names);
            for (let name of names) {
                let source;
                if (disabled.indexOf(name) !== -1)
                    continue;
                try {
                    if (natives_1.default.has(name)) {
                        source = yield natives_1.default.getSource(nvim, name);
                    }
                    else {
                        source = yield remotes_1.default.getSource(nvim, name);
                    }
                }
                catch (e) {
                    logger_1.logger.error(`Source ${name} can not be created`);
                }
                res.push(source);
            }
            logger_1.logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`);
            return res;
        });
    }
}
exports.Completes = Completes;
exports.default = new Completes();
//# sourceMappingURL=completes.js.map