"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class DocumentLinkManager extends manager_1.default {
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
    async _provideDocumentLinks(item, document, token) {
        let { provider, id } = item;
        let items = await Promise.resolve(provider.provideDocumentLinks(document, token));
        if (!items || !items.length)
            return [];
        items.forEach(item => {
            item.data = item.data || {};
            item.data.source = id;
        });
        return items;
    }
    async provideDocumentLinks(document, token) {
        let items = this.getProviders(document);
        if (items.length == 0)
            return [];
        const arr = await Promise.all(items.map(item => {
            return this._provideDocumentLinks(item, document, token);
        }));
        return [].concat(...arr);
    }
    async resolveDocumentLink(link, token) {
        let { data } = link;
        if (!data || !data.source)
            return null;
        for (let item of this.providers) {
            if (item.id == data.source) {
                let { provider } = item;
                link = await Promise.resolve(provider.resolveDocumentLink(link, token));
                return link;
            }
        }
        return null;
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = DocumentLinkManager;
//# sourceMappingURL=documentLinkManager.js.map