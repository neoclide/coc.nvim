/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const Is = tslib_1.__importStar(require("../util/is"));
const UUID = tslib_1.__importStar(require("./utils/uuid"));
const languages_1 = tslib_1.__importDefault(require("../languages"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const converter_1 = require("./utils/converter");
const client_1 = require("./client");
function ensure(target, key) {
    if (target[key] === void 0) {
        target[key] = {};
    }
    return target[key];
}
class DeclarationFeature extends client_1.TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DeclarationRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let declarationSupport = ensure(ensure(capabilites, 'textDocument'), 'declaration');
        declarationSupport.dynamicRegistration = true;
        // declarationSupport.linkSupport = true
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.declarationProvider) {
            return;
        }
        if (capabilities.declarationProvider === true) {
            if (!documentSelector) {
                return;
            }
            this.register(this.messages, {
                id: UUID.generateUuid(),
                registerOptions: Object.assign({}, { documentSelector })
            });
        }
        else {
            const declCapabilities = capabilities.declarationProvider;
            const id = Is.string(declCapabilities.id) && declCapabilities.id.length > 0 ? declCapabilities.id : UUID.generateUuid();
            const selector = declCapabilities.documentSelector || documentSelector;
            if (selector) {
                this.register(this.messages, {
                    id,
                    registerOptions: Object.assign({}, { documentSelector: selector })
                });
            }
        }
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideDeclaration = (document, position, token) => {
            return client.sendRequest(vscode_languageserver_protocol_1.DeclarationRequest.type, converter_1.asTextDocumentPositionParams(document, position), token).then(res => res, error => {
                client.logFailedRequest(vscode_languageserver_protocol_1.DeclarationRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDeclarationProvider(options.documentSelector, {
            provideDeclaration: (document, position, token) => {
                return middleware.provideDeclaration
                    ? middleware.provideDeclaration(document, position, token, provideDeclaration)
                    : provideDeclaration(document, position, token);
            }
        });
    }
}
exports.DeclarationFeature = DeclarationFeature;
//# sourceMappingURL=declaration.js.map