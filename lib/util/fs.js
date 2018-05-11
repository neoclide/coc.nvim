"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const pify = require("pify");
const fs = require("fs");
const path = require("path");
const exec = require('child_process').exec;
function statAsync(filepath) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let stat = null;
        try {
            stat = yield pify(fs.stat)(filepath);
        }
        catch (e) { } // tslint:disable-line
        return stat;
    });
}
exports.statAsync = statAsync;
function isGitIgnored(fullpath) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!fullpath)
            return false;
        let root = null;
        try {
            let out = yield pify(exec)('git rev-parse --show-toplevel', { cwd: path.dirname(fullpath) });
            root = out.replace(/\r?\n$/, '');
        }
        catch (e) { } // tslint:disable-line
        if (!root)
            return false;
        let file = path.relative(root, fullpath);
        try {
            let out = yield pify(exec)(`git check-ignore ${file}`, { cwd: root });
            return out.replace(/\r?\n$/, '') == file;
        }
        catch (e) { } // tslint:disable-line
        return false;
    });
}
exports.isGitIgnored = isGitIgnored;
//# sourceMappingURL=fs.js.map