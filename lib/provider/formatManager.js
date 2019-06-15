"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class FormatManager extends manager_1.default {
    register(selector, provider, priority = 0) {
        let item = {
            id: uuid(),
            selector,
            priority,
            provider
        };
        this.providers.add(item);
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.providers.delete(item);
        });
    }
    async provideDocumentFormattingEdits(document, options, token) {
        let item = this.getProvider(document);
        if (!item)
            return null;
        let { provider } = item;
        return await Promise.resolve(provider.provideDocumentFormattingEdits(document, options, token));
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = FormatManager;
//# sourceMappingURL=formatManager.js.map