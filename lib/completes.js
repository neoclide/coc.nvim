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
        let complete = new complete_1.default(opts);
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
            let nativeNames = natives_1.default.names;
            logger_1.logger.debug(`Disabled sources:${disabled}`);
            let names = nativeNames.concat(remotes_1.default.names);
            names = names.filter(n => disabled.indexOf(n) === -1);
            let res = yield Promise.all(names.map(name => {
                if (nativeNames.indexOf(name) !== -1) {
                    return natives_1.default.getSource(nvim, name);
                }
                return remotes_1.default.getSource(nvim, name);
            }));
            res = res.filter(o => o != null);
            logger_1.logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`);
            return res;
        });
    }
    reset() {
        this.complete = null;
    }
}
exports.Completes = Completes;
exports.default = new Completes();
//# sourceMappingURL=completes.js.map