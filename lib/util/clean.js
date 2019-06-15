"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const fs_1 = tslib_1.__importDefault(require("fs"));
const glob_1 = tslib_1.__importDefault(require("glob"));
const os_1 = require("os");
const util_1 = tslib_1.__importDefault(require("util"));
const fs_2 = require("./fs");
async function default_1() {
    if (global.hasOwnProperty('__TEST__'))
        return;
    try {
        let dir = os_1.tmpdir();
        let files = glob_1.default.sync(path_1.default.join(dir, '/coc-*.sock'));
        for (let file of files) {
            let valid = await fs_2.validSocket(file);
            if (!valid)
                await util_1.default.promisify(fs_1.default.unlink)(file);
        }
        files = glob_1.default.sync(path_1.default.join(dir, '/coc-nvim-tscancellation-*'));
        for (let file of files) {
            await util_1.default.promisify(fs_1.default.unlink)(file);
        }
        files = glob_1.default.sync(path_1.default.join(dir, '/ti-*.log'));
        for (let file of files) {
            await util_1.default.promisify(fs_1.default.unlink)(file);
        }
        files = glob_1.default.sync(path_1.default.join(dir, '/coc-*.vim'));
        for (let file of files) {
            if (path_1.default.basename(file) != `coc-${process.pid}.vim`) {
                await util_1.default.promisify(fs_1.default.unlink)(file);
            }
        }
    }
    catch (e) {
        // noop
    }
}
exports.default = default_1;
//# sourceMappingURL=clean.js.map