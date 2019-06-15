"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const manager_1 = tslib_1.__importDefault(require("./manager"));
const uuid = require("uuid/v4");
const lodash_1 = require("../util/lodash");
// const logger = require('../util/logger')('codeActionManager')
class CodeLensManager extends manager_1.default {
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
    async provideCodeLenses(document, token) {
        let providers = this.getProviders(document);
        if (!providers.length)
            return null;
        let arr = await Promise.all(providers.map(item => {
            let { provider, id } = item;
            return Promise.resolve(provider.provideCodeLenses(document, token)).then(res => {
                if (Array.isArray(res)) {
                    for (let item of res) {
                        item.source = id;
                    }
                }
                return res || [];
            });
        }));
        return [].concat(...arr);
    }
    async resolveCodeLens(codeLens, token) {
        // no need to resolve
        if (codeLens.command)
            return codeLens;
        let { source } = codeLens;
        let provider = this.poviderById(source);
        if (!provider || typeof provider.resolveCodeLens != 'function') {
            // tslint:disable-next-line:no-console
            console.error(`CodeLens Resolve not supported`);
            return codeLens;
        }
        let res = await Promise.resolve(provider.resolveCodeLens(lodash_1.omit(codeLens, ['source']), token));
        Object.assign(codeLens, res);
        return codeLens;
    }
    dispose() {
        this.providers = new Set();
    }
}
exports.default = CodeLensManager;
//# sourceMappingURL=codeLensManager.js.map