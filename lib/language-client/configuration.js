"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('languageclient-configuration');
class ConfigurationFeature {
    constructor(_client) {
        this._client = _client;
    }
    fillClientCapabilities(capabilities) {
        capabilities.workspace = capabilities.workspace || {};
        capabilities.workspace.configuration = true;
    }
    initialize() {
        let client = this._client;
        client.onRequest(vscode_languageserver_protocol_1.ConfigurationRequest.type, (params, token) => {
            let configuration = params => {
                let result = [];
                for (let item of params.items) {
                    result.push(this.getConfiguration(item.scopeUri, item.section));
                }
                return result;
            };
            let middleware = client.clientOptions.middleware.workspace;
            return middleware && middleware.configuration
                ? middleware.configuration(params, token, configuration)
                : configuration(params, token);
        });
    }
    getConfiguration(resource, section) {
        let result = null;
        if (section) {
            let index = section.lastIndexOf('.');
            if (index === -1) {
                result = workspace_1.default.getConfiguration(undefined, resource).get(section, {});
            }
            else {
                let config = workspace_1.default.getConfiguration(section.substr(0, index), resource);
                if (config) {
                    result = config.get(section.substr(index + 1));
                }
            }
        }
        else {
            let config = workspace_1.default.getConfiguration(undefined, resource);
            result = {};
            for (let key of Object.keys(config)) {
                if (config.has(key)) {
                    result[key] = config.get(key);
                }
            }
        }
        return result;
    }
}
exports.ConfigurationFeature = ConfigurationFeature;
//# sourceMappingURL=configuration.js.map