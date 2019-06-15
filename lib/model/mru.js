"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const os_1 = tslib_1.__importDefault(require("os"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const util_1 = tslib_1.__importDefault(require("util"));
const isWindows = process.platform == 'win32';
const root = isWindows ? path_1.default.join(os_1.default.homedir(), 'AppData/Local/coc') : path_1.default.join(os_1.default.homedir(), '.config/coc');
class Mru {
    constructor(name, base) {
        this.name = name;
        this.file = path_1.default.join(base || root, name);
    }
    async load() {
        try {
            let content = await util_1.default.promisify(fs_1.default.readFile)(this.file, 'utf8');
            content = content.trim();
            return content.length ? content.trim().split('\n') : [];
        }
        catch (e) {
            return [];
        }
    }
    async add(item) {
        let items = await this.load();
        let idx = items.indexOf(item);
        if (idx !== -1)
            items.splice(idx, 1);
        items.unshift(item);
        await util_1.default.promisify(fs_1.default.writeFile)(this.file, items.join('\n'), 'utf8');
    }
    async remove(item) {
        let items = await this.load();
        let idx = items.indexOf(item);
        if (idx !== -1) {
            items.splice(idx, 1);
            await util_1.default.promisify(fs_1.default.writeFile)(this.file, items.join('\n'), 'utf8');
        }
    }
    async clean() {
        try {
            await util_1.default.promisify(fs_1.default.unlink)(this.file);
        }
        catch (e) {
            // noop
        }
    }
}
exports.default = Mru;
//# sourceMappingURL=mru.js.map