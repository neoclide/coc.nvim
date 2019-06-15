"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const is_1 = require("../util/is");
const object_1 = require("../util/object");
const util_1 = require("./util");
class ConfigurationModel {
    constructor(_contents = {}) {
        this._contents = _contents;
    }
    get contents() {
        return this._contents;
    }
    clone() {
        return new ConfigurationModel(object_1.deepClone(this._contents));
    }
    getValue(section) {
        let res = section
            ? util_1.getConfigurationValue(this.contents, section)
            : this.contents;
        return res;
    }
    merge(...others) {
        const contents = object_1.deepClone(this.contents);
        for (const other of others) {
            this.mergeContents(contents, other.contents);
        }
        return new ConfigurationModel(contents);
    }
    freeze() {
        if (!Object.isFrozen(this._contents)) {
            Object.freeze(this._contents);
        }
        return this;
    }
    mergeContents(source, target) {
        for (const key of Object.keys(target)) {
            if (key in source) {
                if (is_1.objectLiteral(source[key]) && is_1.objectLiteral(target[key])) {
                    this.mergeContents(source[key], target[key]);
                    continue;
                }
            }
            source[key] = object_1.deepClone(target[key]);
        }
    }
    // Update methods
    setValue(key, value) {
        util_1.addToValueTree(this.contents, key, value, message => {
            // tslint:disable-next-line:no-console
            console.error(message);
        });
    }
    removeValue(key) {
        util_1.removeFromValueTree(this.contents, key);
    }
}
exports.ConfigurationModel = ConfigurationModel;
//# sourceMappingURL=model.js.map