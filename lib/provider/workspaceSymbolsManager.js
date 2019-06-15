"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class WorkspaceSymbolManager extends manager_1.default {
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
    async provideWorkspaceSymbols(document, query, token) {
        let item = this.getProvider(document);
        if (!item)
            return null;
        let { provider } = item;
        let res = await Promise.resolve(provider.provideWorkspaceSymbols(query, token));
        res = res || [];
        for (let sym of res) {
            sym.source = item.id;
        }
        return res;
    }
    async resolveWorkspaceSymbol(symbolInfo, token) {
        let item = Array.from(this.providers).find(o => o.id == symbolInfo.source);
        if (!item)
            return;
        let { provider } = item;
        if (typeof provider.resolveWorkspaceSymbol != 'function') {
            return Promise.resolve(symbolInfo);
        }
        return await Promise.resolve(provider.resolveWorkspaceSymbol(symbolInfo, token));
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = WorkspaceSymbolManager;
//# sourceMappingURL=workspaceSymbolsManager.js.map