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
class SelectionRangeFeature extends client_1.TextDocumentFeature {
    constructor(client) {
        super(client, vscode_languageserver_protocol_1.SelectionRangeRequest.type);
    }
    fillClientCapabilities(capabilites) {
        let capability = ensure(ensure(capabilites, 'textDocument'), 'selectionRange');
        capability.dynamicRegistration = true;
    }
    initialize(capabilities, documentSelector) {
        if (!capabilities.selectionRangeProvider) {
            return;
        }
        const implCapabilities = capabilities.selectionRangeProvider;
        const id = Is.string(implCapabilities.id) && implCapabilities.id.length > 0 ? implCapabilities.id : UUID.generateUuid();
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
        let provideSelectionRanges = (document, positions, token) => {
            const requestParams = {
                textDocument: { uri: document.uri },
                positions
            };
            return client.sendRequest(vscode_languageserver_protocol_1.SelectionRangeRequest.type, requestParams, token).then(ranges => ranges, (error) => {
                client.logFailedRequest(vscode_languageserver_protocol_1.SelectionRangeRequest.type, error);
                return Promise.resolve(null);
            });
        };
        let middleware = client.clientOptions.middleware;
        return languages_1.default.registerSelectionRangeProvider(options.documentSelector, {
            provideSelectionRanges(document, positions, token) {
                return middleware.provideSelectionRanges
                    ? middleware.provideSelectionRanges(document, positions, token, provideSelectionRanges)
                    : provideSelectionRanges(document, positions, token);
            }
        });
    }
}
exports.SelectionRangeFeature = SelectionRangeFeature;
//# sourceMappingURL=selectionRange.js.map