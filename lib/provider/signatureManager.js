"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
class SignatureManager extends manager_1.default {
    register(selector, provider, triggerCharacters) {
        let characters = triggerCharacters.reduce((p, c) => {
            return p.concat(c.split(/\s*/g));
        }, []);
        let item = {
            id: uuid(),
            selector,
            provider,
            triggerCharacters: characters
        };
        this.providers.add(item);
        return vscode_languageserver_protocol_1.Disposable.create(() => {
            this.providers.delete(item);
        });
    }
    shouldTrigger(document, triggerCharacter) {
        let item = this.getProvider(document);
        if (!item)
            return false;
        let { triggerCharacters } = item;
        return triggerCharacters && triggerCharacters.indexOf(triggerCharacter) != -1;
    }
    async provideSignatureHelp(document, position, token) {
        let item = this.getProvider(document);
        if (!item)
            return null;
        let res = await Promise.resolve(item.provider.provideSignatureHelp(document, position, token));
        if (res && res.signatures && res.signatures.length)
            return res;
        return null;
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = SignatureManager;
//# sourceMappingURL=signatureManager.js.map