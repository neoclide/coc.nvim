"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class TypeDefinitionManager extends manager_1.default {
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
    async provideTypeDefinition(document, position, token) {
        let providers = this.getProviders(document);
        if (!providers.length)
            return null;
        let arr = await Promise.all(providers.map(item => {
            let { provider } = item;
            return Promise.resolve(provider.provideTypeDefinition(document, position, token));
        }));
        return this.mergeDefinitions(arr);
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = TypeDefinitionManager;
//# sourceMappingURL=typeDefinitionManager.js.map