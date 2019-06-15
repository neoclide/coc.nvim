"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class SelectionRangeManager extends manager_1.default {
    register(selector, provider) {
        let item = {
            id: uuid(),
            selector,
            provider
        };
        this.providers.add(item);
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.providers.delete(item);
        });
    }
    async provideSelectionRanges(document, positions, token) {
        let item = this.getProvider(document);
        if (!item)
            return null;
        let { provider } = item;
        return await Promise.resolve(provider.provideSelectionRanges(document, positions, token));
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = SelectionRangeManager;
//# sourceMappingURL=rangeManager.js.map