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
        this.chars = [];
    }
    addRecent(word) {
        let val = this.recentScores[word];
        if (!val) {
            this.recentScores[word] = 0.05;
        }
        else {
            this.recentScores[word] = Math.max(val + 0.05, 0.2);
        }
    }
    newComplete(opts) {
        let complete = new complete_1.default(opts);
        complete.recentScores = this.recentScores;
        return complete;
    }
    createComplete(opts) {
        let complete = this.newComplete(opts);
        this.complete = complete;
        return complete;
    }
    getSources(nvim, filetype) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let disabled = config_1.getConfig('disabled');
            let nativeNames = natives_1.default.names;
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
        this.complete = null;
        this.chars = [];
    }
    calculateChars() {
        let { results } = this.complete;
        if (!results.length)
            return;
        let chars = [];
        for (let res of results) {
            let { items } = res;
            if (!items)
                break;
            for (let item of items) {
                let word = item.abbr ? item.abbr : item.word;
                for (let ch of word) {
                    if (chars.indexOf(ch) == -1) {
                        chars.push(ch);
                    }
                }
            }
        }
        this.chars = chars;
    }
}
exports.Completes = Completes;
exports.default = new Completes();
//# sourceMappingURL=completes.js.map