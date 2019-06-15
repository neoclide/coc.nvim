"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('provider-manager');
class Manager {
    constructor() {
        this.providers = new Set();
    }
    hasProvider(document) {
        return this.getProvider(document) != null;
    }
    getProvider(document) {
        let currScore = 0;
        let providerItem;
        for (let item of this.providers) {
            let { selector, priority } = item;
            let score = workspace_1.default.match(selector, document);
            if (score == 0)
                continue;
            if (typeof priority == 'number') {
                score = priority;
            }
            if (score < currScore)
                continue;
            currScore = score;
            providerItem = item;
        }
        return providerItem;
    }
    poviderById(id) {
        let item = Array.from(this.providers).find(o => o.id == id);
        return item ? item.provider : null;
    }
    getProviders(document) {
        let items = Array.from(this.providers);
        items = items.filter(item => {
            return workspace_1.default.match(item.selector, document) > 0;
        });
        return items.sort((a, b) => {
            return workspace_1.default.match(b.selector, document) - workspace_1.default.match(a.selector, document);
        });
    }
    mergeDefinitions(arr) {
        let res = [];
        for (let def of arr) {
            if (!def)
                continue;
            if (vscode_languageserver_protocol_1.Location.is(def)) {
                let { uri, range } = def;
                let idx = res.findIndex(l => l.uri == uri && l.range.start.line == range.start.line);
                if (idx == -1) {
                    res.push(def);
                }
            }
            else if (Array.isArray(def)) {
                for (let d of def) {
                    let { uri, range } = d;
                    let idx = res.findIndex(l => l.uri == uri && l.range.start.line == range.start.line);
                    if (idx == -1) {
                        res.push(d);
                    }
                }
            }
            else {
                workspace_1.default.showMessage(`Bad definition ${JSON.stringify(def)}`, 'error');
            }
        }
        return res;
    }
}
exports.default = Manager;
//# sourceMappingURL=manager.js.map