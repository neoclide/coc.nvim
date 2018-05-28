"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("./config");
const complete_1 = require("./model/complete");
const natives_1 = require("./natives");
const remotes_1 = require("./remotes");
const logger = require('./util/logger')('completes');
class Completes {
    constructor() {
        this.complete = null;
        this.recentScores = {};
        this.charCodes = [];
    }
    addRecent(word) {
        if (!word.length)
            return;
        let { input } = this.option;
        let key = `${input.slice(0, 3)}|${word}`;
        let val = this.recentScores[key];
        if (!val) {
            this.recentScores[key] = 0.1;
        }
        else {
            this.recentScores[key] = Math.max(val + 0.1, 0.3);
        }
    }
    newComplete(opts) {
        let complete = new complete_1.default(opts);
        complete.recentScores = this.recentScores;
        return complete;
    }
    // complete on start
    createComplete(opts) {
        let complete = this.newComplete(opts);
        this.complete = complete;
        return complete;
    }
    getSources(nvim, filetype) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let disabled = config_1.getConfig('disabled');
            let nativeNames = natives_1.default.getSourceNamesOfFiletype(filetype);
            logger.debug(`Disabled sources:${disabled}`);
            let names = nativeNames.concat(remotes_1.default.names);
            names = names.filter(n => disabled.indexOf(n) === -1);
            let res = yield Promise.all(names.map(name => {
                if (nativeNames.indexOf(name) !== -1) {
                    return natives_1.default.getSource(nvim, name);
                }
                return remotes_1.default.getSource(nvim, name);
            }));
            res = res.filter(o => o != null);
            logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`);
            return res;
        });
    }
    getSource(nvim, name) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (natives_1.default.has(name))
                return yield natives_1.default.getSource(nvim, name);
            if (remotes_1.default.has(name))
                return yield remotes_1.default.getSource(nvim, name);
            return null;
        });
    }
    reset() {
        this.charCodes = [];
    }
    calculateChars(items) {
        let res = [];
        if (!this.complete)
            return;
        for (let item of items) {
            let user_data = JSON.parse(item.user_data);
            let s = user_data.filter == 'abbr' ? item.abbr : item.word;
            for (let i = 0, l = s.length; i < l; i++) {
                let code = s.charCodeAt(i);
                // not supported for filter
                if (code > 256)
                    continue;
                if (res.indexOf(code) === -1) {
                    res.push(code);
                }
                if (code >= 65 && code <= 90 && res.indexOf(code + 32) === -1) {
                    res.push(code + 32);
                }
            }
        }
        this.charCodes = res;
    }
    hasCharacter(ch) {
        let code = ch.charCodeAt(0);
        return this.charCodes.indexOf(code) !== -1;
    }
    get option() {
        let { complete } = this;
        if (!complete)
            return null;
        return complete.option;
    }
}
exports.Completes = Completes;
exports.default = new Completes();
//# sourceMappingURL=completes.js.map