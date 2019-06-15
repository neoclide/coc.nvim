"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const os_1 = tslib_1.__importDefault(require("os"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const path_1 = tslib_1.__importDefault(require("path"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const types_1 = require("../types");
const object_1 = require("../util/object");
const util_1 = require("../util");
const configuration_1 = require("./configuration");
const model_1 = require("./model");
const util_2 = require("./util");
const is_1 = require("../util/is");
const fs_2 = require("../util/fs");
const logger = require('../util/logger')('configurations');
function lookUp(tree, key) {
    if (key) {
        if (tree && tree.hasOwnProperty(key))
            return tree[key];
        const parts = key.split('.');
        let node = tree;
        for (let i = 0; node && i < parts.length; i++) {
            node = node[parts[i]];
        }
        return node;
    }
    return tree;
}
class Configurations {
    constructor(userConfigFile, _proxy) {
        this.userConfigFile = userConfigFile;
        this._proxy = _proxy;
        this._errorItems = [];
        this._folderConfigurations = new Map();
        this._onError = new vscode_languageserver_protocol_1.Emitter();
        this._onChange = new vscode_languageserver_protocol_1.Emitter();
        this.disposables = [];
        this.onError = this._onError.event;
        this.onDidChange = this._onChange.event;
        let user = this.parseContentFromFile(userConfigFile);
        let data = {
            defaults: util_2.loadDefaultConfigurations(),
            user,
            workspace: { contents: {} }
        };
        this._configuration = Configurations.parse(data);
        this.watchFile(userConfigFile, types_1.ConfigurationTarget.User);
    }
    parseContentFromFile(filepath) {
        if (!filepath)
            return { contents: {} };
        let uri = vscode_uri_1.URI.file(filepath).toString();
        this._errorItems = this._errorItems.filter(o => o.location.uri != uri);
        let res = util_2.parseContentFromFile(filepath, errors => {
            this._errorItems.push(...errors);
        });
        this._onError.fire(this._errorItems);
        return res;
    }
    get errorItems() {
        return this._errorItems;
    }
    get foldConfigurations() {
        return this._folderConfigurations;
    }
    // used for extensions, no change event fired
    extendsDefaults(props) {
        let { defaults } = this._configuration;
        let { contents } = defaults;
        contents = object_1.deepClone(contents);
        Object.keys(props).forEach(key => {
            util_2.addToValueTree(contents, key, props[key], msg => {
                logger.error(msg); // tslint:disable-line
            });
        });
        let data = {
            defaults: { contents },
            user: this._configuration.user,
            workspace: this._configuration.workspace
        };
        this._configuration = Configurations.parse(data);
    }
    // change user configuration, without change file
    updateUserConfig(props) {
        if (!props || Object.keys(props).length == 0)
            return;
        let { user } = this._configuration;
        let model = user.clone();
        Object.keys(props).forEach(key => {
            let val = props[key];
            if (val === undefined) {
                model.removeValue(key);
            }
            else if (is_1.objectLiteral(val)) {
                for (let k of Object.keys(val)) {
                    model.setValue(`${key}.${k}`, val[k]);
                }
            }
            else {
                model.setValue(key, val);
            }
        });
        this.changeConfiguration(types_1.ConfigurationTarget.User, model);
    }
    get defaults() {
        return this._configuration.defaults;
    }
    get user() {
        return this._configuration.user;
    }
    get workspace() {
        return this._configuration.workspace;
    }
    addFolderFile(filepath) {
        let { _folderConfigurations } = this;
        if (_folderConfigurations.has(filepath))
            return;
        if (path_1.default.resolve(filepath, '../..') == os_1.default.homedir())
            return;
        let model = this.parseContentFromFile(filepath);
        _folderConfigurations.set(filepath, new model_1.ConfigurationModel(model.contents));
        this.watchFile(filepath, types_1.ConfigurationTarget.Workspace);
        this.changeConfiguration(types_1.ConfigurationTarget.Workspace, model, filepath);
    }
    watchFile(filepath, target) {
        if (!fs_1.default.existsSync(filepath))
            return;
        if (global.hasOwnProperty('__TEST__'))
            return;
        let disposable = util_1.watchFile(filepath, () => {
            let model = this.parseContentFromFile(filepath);
            this.changeConfiguration(target, model, filepath);
        });
        this.disposables.push(disposable);
    }
    // create new configuration and fire change event
    changeConfiguration(target, model, configFile) {
        let { defaults, user, workspace } = this._configuration;
        let { workspaceConfigFile } = this;
        let data = {
            defaults: target == types_1.ConfigurationTarget.Global ? model : defaults,
            user: target == types_1.ConfigurationTarget.User ? model : user,
            workspace: target == types_1.ConfigurationTarget.Workspace ? model : workspace,
        };
        let configuration = Configurations.parse(data);
        let changed = util_2.getChangedKeys(this._configuration.getValue(), configuration.getValue());
        if (target == types_1.ConfigurationTarget.Workspace)
            this.workspaceConfigFile = configFile;
        if (changed.length == 0)
            return;
        this._configuration = configuration;
        this._onChange.fire({
            affectsConfiguration: (section, resource) => {
                if (!resource || target != types_1.ConfigurationTarget.Workspace)
                    return changed.indexOf(section) !== -1;
                let u = vscode_uri_1.URI.parse(resource);
                if (u.scheme !== 'file')
                    return changed.indexOf(section) !== -1;
                let filepath = u.fsPath;
                let preRoot = workspaceConfigFile ? path_1.default.resolve(workspaceConfigFile, '../..') : '';
                if (configFile && !fs_2.isParentFolder(preRoot, filepath) && !fs_2.isParentFolder(path_1.default.resolve(configFile, '../..'), filepath)) {
                    return false;
                }
                return changed.indexOf(section) !== -1;
            }
        });
    }
    setFolderConfiguration(uri) {
        let u = vscode_uri_1.URI.parse(uri);
        if (u.scheme != 'file')
            return;
        let filepath = u.fsPath;
        for (let [configFile, model] of this.foldConfigurations) {
            let root = path_1.default.resolve(configFile, '../..');
            if (fs_2.isParentFolder(root, filepath) && this.workspaceConfigFile != configFile) {
                this.changeConfiguration(types_1.ConfigurationTarget.Workspace, model, configFile);
                break;
            }
        }
    }
    hasFolderConfiguration(filepath) {
        let { folders } = this;
        return folders.findIndex(f => fs_2.isParentFolder(f, filepath)) !== -1;
    }
    getConfigFile(target) {
        if (target == types_1.ConfigurationTarget.Global)
            return null;
        if (target == types_1.ConfigurationTarget.User)
            return this.userConfigFile;
        return this.workspaceConfigFile;
    }
    get folders() {
        let res = [];
        let { _folderConfigurations } = this;
        for (let folder of _folderConfigurations.keys()) {
            res.push(path_1.default.resolve(folder, '../..'));
        }
        return res;
    }
    get configuration() {
        return this._configuration;
    }
    /**
     * getConfiguration
     *
     * @public
     * @param {string} section
     * @returns {WorkspaceConfiguration}
     */
    getConfiguration(section, resource) {
        let configuration;
        if (resource) {
            let { defaults, user } = this._configuration;
            configuration = new configuration_1.Configuration(defaults, user, this.getFolderConfiguration(resource));
        }
        else {
            configuration = this._configuration;
        }
        const config = Object.freeze(lookUp(configuration.getValue(null), section));
        const result = {
            has(key) {
                return typeof lookUp(config, key) !== 'undefined';
            },
            get: (key, defaultValue) => {
                let result = lookUp(config, key);
                if (result == null)
                    return defaultValue;
                return result;
            },
            update: (key, value, isUser = false) => {
                let s = section ? `${section}.${key}` : key;
                // if (!this.workspaceConfigFile) isUser = true
                let target = isUser ? types_1.ConfigurationTarget.User : types_1.ConfigurationTarget.Workspace;
                let model = target == types_1.ConfigurationTarget.User ? this.user.clone() : this.workspace.clone();
                if (value == undefined) {
                    model.removeValue(s);
                }
                else {
                    model.setValue(s, value);
                }
                this.changeConfiguration(target, model, target == types_1.ConfigurationTarget.Workspace ? this.workspaceConfigFile : this.userConfigFile);
                if (this._proxy && !global.hasOwnProperty('__TEST__')) {
                    if (value == undefined) {
                        this._proxy.$removeConfigurationOption(target, s);
                    }
                    else {
                        this._proxy.$updateConfigurationOption(target, s, value);
                    }
                }
            },
            inspect: (key) => {
                key = section ? `${section}.${key}` : key;
                const config = this._configuration.inspect(key);
                if (config) {
                    return {
                        key,
                        defaultValue: config.default,
                        globalValue: config.user,
                        workspaceValue: config.workspace,
                    };
                }
                return undefined;
            }
        };
        Object.defineProperty(result, 'has', {
            enumerable: false
        });
        Object.defineProperty(result, 'get', {
            enumerable: false
        });
        Object.defineProperty(result, 'update', {
            enumerable: false
        });
        Object.defineProperty(result, 'inspect', {
            enumerable: false
        });
        if (typeof config === 'object') {
            object_1.mixin(result, config, false);
        }
        return object_1.deepFreeze(result);
    }
    getFolderConfiguration(uri) {
        let u = vscode_uri_1.URI.parse(uri);
        if (u.scheme != 'file')
            return new model_1.ConfigurationModel();
        let filepath = u.fsPath;
        for (let [configFile, model] of this.foldConfigurations) {
            let root = path_1.default.resolve(configFile, '../..');
            if (fs_2.isParentFolder(root, filepath))
                return model;
        }
        return new model_1.ConfigurationModel();
    }
    checkFolderConfiguration(uri) {
        let u = vscode_uri_1.URI.parse(uri);
        if (u.scheme != 'file')
            return;
        let rootPath = path_1.default.dirname(u.fsPath);
        if (!this.hasFolderConfiguration(rootPath)) {
            let folder = fs_2.findUp('.vim', rootPath);
            if (folder && folder != os_1.default.homedir()) {
                let file = path_1.default.join(folder, 'coc-settings.json');
                if (fs_1.default.existsSync(file)) {
                    this.addFolderFile(file);
                }
            }
        }
        else {
            this.setFolderConfiguration(uri);
        }
    }
    static parse(data) {
        const defaultConfiguration = new model_1.ConfigurationModel(data.defaults.contents);
        const userConfiguration = new model_1.ConfigurationModel(data.user.contents);
        const workspaceConfiguration = new model_1.ConfigurationModel(data.workspace.contents);
        return new configuration_1.Configuration(defaultConfiguration, userConfiguration, workspaceConfiguration, new model_1.ConfigurationModel());
    }
    dispose() {
        util_1.disposeAll(this.disposables);
    }
}
exports.default = Configurations;
//# sourceMappingURL=index.js.map