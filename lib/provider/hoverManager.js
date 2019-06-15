"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class HoverManager extends manager_1.default {
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
    async provideHover(document, position, token) {
        let items = this.getProviders(document);
        if (items.length === 0)
            return null;
        let res = [];
        for (let i = 0, len = items.length; i < len; i += 1) {
            const item = items[i];
            let hover = await Promise.resolve(item.provider.provideHover(document, position, token));
            if (hover && hover.contents != '')
                res.push(hover);
        }
        return res;
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = HoverManager;
//# sourceMappingURL=hoverManager.js.map