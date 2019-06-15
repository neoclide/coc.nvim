"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const util_1 = require("../util");
const fs_1 = require("../util/fs");
const decorator_1 = require("../util/decorator");
const logger = require('../util/logger')('model-resolver');
class Resolver {
    get nodeFolder() {
        if (!util_1.executable('npm'))
            return Promise.resolve('');
        return util_1.runCommand('npm --loglevel silent root -g', {}, 3000).then(root => {
            return root.trim();
        });
    }
    get yarnFolder() {
        if (!util_1.executable('yarnpkg'))
            return Promise.resolve('');
        return util_1.runCommand('yarnpkg global dir', {}, 3000).then(root => {
            return path_1.default.join(root.trim(), 'node_modules');
        });
    }
    async resolveModule(mod) {
        let nodeFolder = await this.nodeFolder;
        let yarnFolder = await this.yarnFolder;
        if (yarnFolder) {
            let s = await fs_1.statAsync(path_1.default.join(yarnFolder, mod, 'package.json'));
            if (s && s.isFile())
                return path_1.default.join(yarnFolder, mod);
        }
        if (nodeFolder) {
            let s = await fs_1.statAsync(path_1.default.join(nodeFolder, mod, 'package.json'));
            if (s && s.isFile())
                return path_1.default.join(nodeFolder, mod);
        }
        return null;
    }
}
tslib_1.__decorate([
    decorator_1.memorize
], Resolver.prototype, "nodeFolder", null);
tslib_1.__decorate([
    decorator_1.memorize
], Resolver.prototype, "yarnFolder", null);
exports.default = Resolver;
//# sourceMappingURL=resolver.js.map