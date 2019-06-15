"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const model_1 = require("./model");
class Configuration {
    constructor(_defaultConfiguration, _userConfiguration, _workspaceConfiguration, _memoryConfiguration = new model_1.ConfigurationModel()) {
        this._defaultConfiguration = _defaultConfiguration;
        this._userConfiguration = _userConfiguration;
        this._workspaceConfiguration = _workspaceConfiguration;
        this._memoryConfiguration = _memoryConfiguration;
    }
    getConsolidateConfiguration() {
        if (!this._consolidateConfiguration) {
            this._consolidateConfiguration = this._defaultConfiguration.merge(this._userConfiguration, this._workspaceConfiguration, this._memoryConfiguration);
            this._consolidateConfiguration = this._consolidateConfiguration.freeze();
        }
        return this._consolidateConfiguration;
    }
    getValue(section) {
        let configuration = this.getConsolidateConfiguration();
        return configuration.getValue(section);
    }
    inspect(key) {
        const consolidateConfigurationModel = this.getConsolidateConfiguration();
        const { _workspaceConfiguration, _memoryConfiguration } = this;
        return {
            default: this._defaultConfiguration.freeze().getValue(key),
            user: this._userConfiguration.freeze().getValue(key),
            workspace: _workspaceConfiguration.freeze().getValue(key),
            memory: _memoryConfiguration.freeze().getValue(key),
            value: consolidateConfigurationModel.getValue(key)
        };
    }
    get defaults() {
        return this._defaultConfiguration;
    }
    get user() {
        return this._userConfiguration;
    }
    get workspace() {
        return this._workspaceConfiguration;
    }
    toData() {
        return {
            defaults: {
                contents: this._defaultConfiguration.contents
            },
            user: {
                contents: this._userConfiguration.contents
            },
            workspace: {
                contents: this._workspaceConfiguration.contents
            }
        };
    }
}
exports.Configuration = Configuration;
//# sourceMappingURL=configuration.js.map