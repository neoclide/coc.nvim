"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class FormatRangeManager extends manager_1.default {
    register(selector, provider, priority = 0) {
        let item = {
            id: uuid(),
            selector,
            provider,
            priority
        };
        this.providers.add(item);
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.providers.delete(item);
        });
    }
    async provideDocumentRangeFormattingEdits(document, range, options, token) {
        let item = this.getProvider(document);
        if (!item)
            return null;
        let { provider } = item;
        return await Promise.resolve(provider.provideDocumentRangeFormattingEdits(document, range, options, token));
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = FormatRangeManager;
//# sourceMappingURL=formatRangeManager.js.map