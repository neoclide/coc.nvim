"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const path = tslib_1.__importStar(require("path"));
const vm = tslib_1.__importStar(require("vm"));
const lodash_1 = require("./lodash");
const createLogger = require('./logger');
const logger = createLogger('util-factoroy');
const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
const Module = require('module');
const REMOVED_GLOBALS = [
    'reallyExit',
    'abort',
    'chdir',
    'umask',
    'setuid',
    'setgid',
    'setgroups',
    '_fatalException',
    'exit',
    'kill',
];
function removedGlobalStub(name) {
    return () => {
        throw new Error(`process.${name}() is not allowed in extension sandbox`);
    };
}
// @see node/lib/internal/module.js
function makeRequireFunction() {
    const req = (p) => {
        if (p === 'coc.nvim') {
            return require('../index');
        }
        return this.require(p);
    };
    req.resolve = (request) => Module._resolveFilename(request, this);
    req.main = process.mainModule;
    // Enable support to add extra extension types
    req.extensions = Module._extensions;
    req.cache = Module._cache;
    return req;
}
// @see node/lib/module.js
function compileInSandbox(sandbox) {
    // eslint-disable-next-line
    return function (content, filename) {
        const require = makeRequireFunction.call(this);
        const dirname = path.dirname(filename);
        // remove shebang
        // eslint-disable-next-line
        const newContent = content.replace(/^\#\!.*/, '');
        const wrapper = Module.wrap(newContent);
        const compiledWrapper = vm.runInContext(wrapper, sandbox, { filename });
        const args = [this.exports, require, this, filename, dirname];
        return compiledWrapper.apply(this.exports, args);
    };
}
function createSandbox(filename, logger) {
    const module = new Module(filename);
    module.paths = Module._nodeModulePaths(filename);
    const sandbox = vm.createContext({
        module,
        Buffer,
        console: {
            log: (...args) => {
                logger.debug.apply(logger, args);
            },
            error: (...args) => {
                logger.error.apply(logger, args);
            },
            info: (...args) => {
                logger.info.apply(logger, args);
            },
            warn: (...args) => {
                logger.warn.apply(logger, args);
            }
        }
    });
    lodash_1.defaults(sandbox, global);
    sandbox.Reflect = Reflect;
    sandbox.require = function sandboxRequire(p) {
        const oldCompile = Module.prototype._compile;
        Module.prototype._compile = compileInSandbox(sandbox);
        const moduleExports = sandbox.module.require(p);
        Module.prototype._compile = oldCompile;
        return moduleExports;
    };
    // patch `require` in sandbox to run loaded module in sandbox context
    // if you need any of these, it might be worth discussing spawning separate processes
    sandbox.process = new process.constructor();
    for (let key of Object.keys(process)) {
        sandbox.process[key] = process[key];
    }
    REMOVED_GLOBALS.forEach(name => {
        sandbox.process[name] = removedGlobalStub(name);
    });
    // read-only umask
    sandbox.process.umask = (mask) => {
        if (typeof mask !== 'undefined') {
            throw new Error('Cannot use process.umask() to change mask (read-only)');
        }
        return process.umask();
    };
    return sandbox;
}
// inspiration drawn from Module
function createExtension(id, filename) {
    if (!fs_1.default.existsSync(filename)) {
        // tslint:disable-next-line:no-empty
        return { activate: () => { }, deactivate: null };
    }
    const sandbox = createSandbox(filename, createLogger(`extension-${id}`));
    delete Module._cache[requireFunc.resolve(filename)];
    // attempt to import plugin
    // Require plugin to export activate & deactivate
    const defaultImport = sandbox.require(filename);
    const activate = (defaultImport && defaultImport.activate) || defaultImport;
    if (typeof activate !== 'function') {
        // tslint:disable-next-line:no-empty
        return { activate: () => { }, deactivate: null };
    }
    return {
        activate,
        deactivate: typeof defaultImport.deactivate === 'function' ? defaultImport.deactivate : null
    };
}
exports.createExtension = createExtension;
//# sourceMappingURL=factory.js.map