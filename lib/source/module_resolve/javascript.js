"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
/**
 * Provide the function to find javscript module names
 */
const builtinModules = require("builtin-modules");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
const findRoot = require("find-root");
const logger = require('../../util/logger')('module-resolve-javascript');
function shouldResolve(opt) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let { line, colnr } = opt;
        let end = line.slice(colnr - 1);
        if (!/(['"]\))?;?$/.test(end))
            return false;
        let start = line.slice(0, colnr - 1);
        if (/require\(['"]\w+$/.test(start))
            return true;
        if (/^import/.test(line) && /from\s+['"]\w+$/.test(start))
            return true;
        return false;
    });
}
exports.shouldResolve = shouldResolve;
function resolve(opt) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        let { filepath } = opt;
        let cwd = path.dirname(filepath);
        let root;
        try {
            root = findRoot(cwd);
        }
        catch (e) { } // tslint:disable-line
        if (root) {
            let content = yield pify(fs.readFile)(path.join(root, 'package.json'), 'utf8');
            try {
                let obj = JSON.parse(content);
                let modules = Object.keys(obj.dependencies || {});
                return modules.concat(builtinModules);
            }
            catch (e) { } // tslint:disable-line
        }
        return builtinModules;
    });
}
exports.resolve = resolve;
//# sourceMappingURL=javascript.js.map