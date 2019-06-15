"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const fsAsync = tslib_1.__importStar(require("../util/fs"));
const util_1 = require("../util");
class DB {
    constructor(filepath) {
        this.filepath = filepath;
    }
    async fetch(key) {
        let obj = await this.load();
        if (obj == null)
            return undefined;
        if (!key)
            return obj;
        let parts = key.split('.');
        for (let part of parts) {
            if (typeof obj[part] == 'undefined') {
                return undefined;
            }
            obj = obj[part];
        }
        return obj;
    }
    fetchSync(key) {
        try {
            let content = fs_1.default.readFileSync(this.filepath, 'utf8');
            let obj = JSON.parse(content);
            if (obj == null)
                return undefined;
            let parts = key.split('.');
            for (let part of parts) {
                if (typeof obj[part] == 'undefined') {
                    return undefined;
                }
                obj = obj[part];
            }
        }
        catch (e) {
            return undefined;
        }
    }
    async exists(key) {
        let obj = await this.load();
        if (obj == null)
            return false;
        let parts = key.split('.');
        for (let part of parts) {
            if (typeof obj[part] == 'undefined') {
                return false;
            }
            obj = obj[part];
        }
        return true;
    }
    async delete(key) {
        let obj = await this.load();
        if (obj == null)
            return;
        let origin = obj;
        let parts = key.split('.');
        let len = parts.length;
        for (let i = 0; i < len; i++) {
            if (typeof obj[parts[i]] == 'undefined') {
                break;
            }
            if (i == len - 1) {
                delete obj[parts[i]];
                await fsAsync.writeFile(this.filepath, JSON.stringify(origin, null, 2));
                break;
            }
            obj = obj[parts[i]];
        }
    }
    async push(key, data) {
        let origin = (await this.load()) || {};
        let obj = origin;
        let parts = key.split('.');
        let len = parts.length;
        if (obj == null) {
            let dir = path_1.default.dirname(this.filepath);
            await util_1.mkdirp(dir);
            obj = origin;
        }
        for (let i = 0; i < len; i++) {
            let key = parts[i];
            if (i == len - 1) {
                obj[key] = data;
                await fsAsync.writeFile(this.filepath, JSON.stringify(origin, null, 2));
                break;
            }
            if (typeof obj[key] == 'undefined') {
                obj[key] = {};
                obj = obj[key];
            }
            else {
                obj = obj[key];
            }
        }
    }
    async load() {
        let stat = await fsAsync.statAsync(this.filepath);
        if (!stat || !stat.isFile())
            return null;
        let content = await fsAsync.readFile(this.filepath, 'utf8');
        if (!content.trim())
            return {};
        try {
            return JSON.parse(content);
        }
        catch (e) {
            return null;
        }
    }
    async clear() {
        let stat = await fsAsync.statAsync(this.filepath);
        if (!stat || !stat.isFile())
            return;
        await fsAsync.writeFile(this.filepath, '');
    }
    async destroy() {
        await fsAsync.unlinkAsync(this.filepath);
    }
}
exports.default = DB;
//# sourceMappingURL=db.js.map