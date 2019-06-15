/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const languages_1 = tslib_1.__importDefault(require("../languages"));
const Is = tslib_1.__importStar(require("../util/is"));
const client_1 = require("./client");
const UUID = tslib_1.__importStar(require("./utils/uuid"));
function ensure(target, key) {
    if (target[key] === void 0) {
        target[key] = {};
    }
    return target[key];
}
class ColorProviderFeature extends client_1.TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.DocumentColorRequest.type);
    }
    fillClientCapabilities(capabilites) {
        ensure(ensure(capabilites, 'textDocument'), 'colorProvider').dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.colorProvider) {
            return;
        }
        const implCapabilities = capabilities.colorProvider;
        const id = Is.string(implCapabilities.id) && implCapabilities.id.length > 0
            ? implCapabilities.id
            : UUID.generateUuid();
        const selector = implCapabilities.documentSelector || documentSelector;
        if (selector) {
            this.register(this.messages, {
                id,
                registerOptions: Object.assign({}, { documentSelector: selector })
            });
        }
    }
    registerLanguageProvider(options) {
        let client = this._client;
        let provideColorPresentations = (color, context, token) => {
            const requestParams = {
                color,
                textDocument: {
                    uri: context.document.uri
                },
                range: context.range
            };
            return client
                .sendRequest(vscode_languageserver_protocol_1.ColorPresentationRequest.type, requestParams, token)
                .then(res => res, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.ColorPresentationRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let provideDocumentColors = (document, token) => {
            const requestParams = {
                textDocument: {
                    uri: document.uri
                }
            };
            return client
                .sendRequest(vscode_languageserver_protocol_1.DocumentColorRequest.type, requestParams, token)
                .then(res => res, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.ColorPresentationRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerDocumentColorProvider(options.documentSelector, {
            provideColorPresentations: (color, context, token) => {
                return middleware.provideColorPresentations
                    ? middleware.provideColorPresentations(color, context, token, provideColorPresentations)
                    : provideColorPresentations(color, context, token);
            },
            provideDocumentColors: (document, token) => {
                return middleware.provideDocumentColors
                    ? middleware.provideDocumentColors(document, token, provideDocumentColors)
                    : provideDocumentColors(document, token);
            }
        });
    }
}
exports.ColorProviderFeature = ColorProviderFeature;
//# sourceMappingURL=colorProvider.js.map