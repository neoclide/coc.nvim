"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
const api_1 = require("./api");
const fs_1 = require("../../util/fs");
class TypeScriptVersion {
    constructor(path, _pathLabel) {
        this.path = path;
        this._pathLabel = _pathLabel;
        this._api = null;
    }
    get tsServerPath() {
        return path.join(this.path, 'tsserver.js');
    }
    get pathLabel() {
        return typeof this._pathLabel === 'undefined' ? this.path : this._pathLabel;
    }
    get isValid() {
        return this.version != null;
    }
    get version() {
        if (this._api)
            return this._api;
        let api = this._api = this.getTypeScriptVersion(this.tsServerPath);
        return api;
    }
    get versionString() {
        const version = this.version;
        return version ? version.versionString : null;
    }
    getTypeScriptVersion(serverPath) {
        if (!fs.existsSync(serverPath)) {
            return undefined;
        }
        const p = serverPath.split(path.sep);
        if (p.length <= 2) {
            return undefined;
        }
        const p2 = p.slice(0, -2);
        const modulePath = p2.join(path.sep);
        let fileName = path.join(modulePath, 'package.json');
        if (!fs.existsSync(fileName)) {
            // Special case for ts dev versions
            if (path.basename(modulePath) === 'built') {
                fileName = path.join(modulePath, '..', 'package.json');
            }
        }
        if (!fs.existsSync(fileName)) {
            return undefined;
        }
        const contents = fs.readFileSync(fileName).toString();
        let desc = null;
        try {
            desc = JSON.parse(contents);
        }
        catch (err) {
            return undefined;
        }
        if (!desc || !desc.version) {
            return undefined;
        }
        return desc.version ? api_1.default.fromVersionString(desc.version) : undefined;
    }
}
exports.TypeScriptVersion = TypeScriptVersion;
class TypeScriptVersionProvider {
    constructor(configuration) {
        this.configuration = configuration;
    }
    updateConfiguration(configuration) {
        this.configuration = configuration;
    }
    get defaultVersion() {
        return this.globalVersion || this.bundledVersion;
    }
    get globalVersion() {
        let { globalTsdk } = this.configuration;
        if (globalTsdk)
            return new TypeScriptVersion(globalTsdk);
        return undefined;
    }
    getLocalVersion(root) {
        let paths = fs_1.getParentDirs(root);
        paths.unshift(root);
        for (let p of paths) {
            if (fs.existsSync(path.join(p, 'node_modules'))) {
                let lib = path.join(p, 'node_modules/typescript/lib');
                return new TypeScriptVersion(lib);
            }
        }
        return null;
    }
    get bundledVersion() {
        try {
            const bundledVersion = new TypeScriptVersion(path.dirname(require.resolve('typescript/lib/tsserver.js')), '');
            return bundledVersion;
        }
        catch (e) {
            // noop
        }
        return null;
    }
}
exports.TypeScriptVersionProvider = TypeScriptVersionProvider;
//# sourceMappingURL=versionProvider.js.map