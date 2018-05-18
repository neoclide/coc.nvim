"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const pify = require("pify");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
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
function findSourceDir(fullpath) {
    let obj = path.parse(fullpath);
    if (!obj || !obj.root)
        return null;
    let { root, dir } = obj;
    let p = dir.slice(root.length);
    let parts = p.split(path.sep);
    let idx = parts.findIndex(s => s == 'src');
    if (idx === -1)
        return null;
    return `${root}${parts.slice(0, idx + 1).join(path.sep)}`;
}
exports.findSourceDir = findSourceDir;
function readFile(fullpath, encoding, timeout = 1000) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            reject(new Error(`Read file ${fullpath} timeout`));
        }, timeout);
        fs.readFile(fullpath, encoding, (err, content) => {
            if (err)
                reject(err);
            resolve(content);
        });
    });
}
exports.readFile = readFile;
function readFileByLine(fullpath, onLine, limit = 50000) {
    const rl = readline.createInterface({
        input: fs.createReadStream(fullpath),
        crlfDelay: Infinity
    });
    let n = 0;
    rl.on('line', line => {
        n = n + 1;
        if (n === limit) {
            rl.close();
        }
        else {
            onLine(line);
        }
    });
    return new Promise((resolve, reject) => {
        rl.on('close', () => {
            resolve();
        });
        rl.on('error', reject);
    });
}
exports.readFileByLine = readFileByLine;
//# sourceMappingURL=fs.js.map