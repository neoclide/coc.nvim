"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const object_1 = require("../util/object");
const logger = require('../util/logger')('model-memos');
class Memos {
    constructor(filepath) {
        this.filepath = filepath;
        if (!fs_1.default.existsSync(filepath)) {
            fs_1.default.writeFileSync(filepath, '{}', 'utf8');
        }
    }
    fetchContent(id, key) {
        try {
            let content = fs_1.default.readFileSync(this.filepath, 'utf8');
            let res = JSON.parse(content);
            let obj = res[id];
            if (!obj)
                return undefined;
            return obj[key];
        }
        catch (e) {
            return undefined;
        }
    }
    async update(id, key, value) {
        let { filepath } = this;
        try {
            let content = fs_1.default.readFileSync(filepath, 'utf8');
            let current = content ? JSON.parse(content) : {};
            current[id] = current[id] || {};
            if (value !== undefined) {
                current[id][key] = object_1.deepClone(value);
            }
            else {
                delete current[id][key];
            }
            content = JSON.stringify(current, null, 2);
            fs_1.default.writeFileSync(filepath, content, 'utf8');
        }
        catch (e) {
            logger.error(`Error on update memos:`, e);
        }
    }
    createMemento(id) {
        return {
            get: (key, defaultValue) => {
                let res = this.fetchContent(id, key);
                return res === undefined ? defaultValue : res;
            },
            update: async (key, value) => {
                await this.update(id, key, value);
            }
        };
    }
}
exports.default = Memos;
//# sourceMappingURL=memos.js.map