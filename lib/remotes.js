"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const source_vim_1 = require("./model/source-vim");
const logger_1 = require("./util/logger");
const path = require("path");
const pify = require("pify");
const fs = require("fs");
class Remotes {
    constructor() {
        this.sourceMap = {};
        this.pathMap = {};
        this.initailized = false;
    }
    get names() {
        return Object.keys(this.pathMap);
    }
    has(name) {
        if (!this.initailized)
            return false;
        return this.names.indexOf(name) !== -1;
    }
    init(nvim) {
        return __awaiter(this, void 0, void 0, function* () {
            let runtimepath = yield nvim.eval('&runtimepath');
            let paths = runtimepath.split(',');
            let { pathMap } = this;
            for (let p of paths) {
                let folder = path.join(p, 'autoload/complete/source');
                try {
                    let stat = yield pify(fs.stat)(folder);
                    if (stat.isDirectory()) {
                        let files = yield pify(fs.readdir)(folder);
                        for (let f of files) {
                            let fullpath = path.join(folder, f);
                            let s = yield pify(fs.stat)(fullpath);
                            if (s.isFile()) {
                                let name = path.basename(f, '.vim');
                                if (this.names.indexOf(name) !== -1) {
                                    logger_1.logger.error(`Same name exists for ${name}`);
                                }
                                else {
                                    pathMap[name] = fullpath;
                                    yield nvim.command(`source ${fullpath}`);
                                    yield this.createSource(nvim, name);
                                }
                            }
                        }
                    }
                }
                catch (e) { } // tslint:disable-line
            }
            logger_1.logger.debug(`pathMap: ${JSON.stringify(this.pathMap)}`);
            this.initailized = true;
        });
    }
    checkFunctions(nvim) {
        return __awaiter(this, void 0, void 0, function* () {
            let res = [];
            let { pathMap } = this;
            for (let name of this.names) {
                let fn = `complete#source#${name}#init`;
                let exists = yield nvim.call('exists', [`*${fn}`]);
                if (exists != 1) {
                    res.push(`Error: ${fn} not found`);
                }
            }
            return res;
        });
    }
    createSource(nvim, name) {
        return __awaiter(this, void 0, void 0, function* () {
            let fn = `complete#source#${name}#init`;
            let exists = yield nvim.call('exists', [`*${fn}`]);
            if (exists != 1) {
                logger_1.logger.error(`Init function not found of ${name}`);
                return null;
            }
            let config = yield nvim.call(fn, []);
            config.engross = !!config.engross;
            if (!Number.isInteger(config.priority)) {
                let priority = parseInt(config.priority, 10);
                config.priority = isNaN(priority) ? 0 : priority;
            }
            let source = new source_vim_1.default(nvim, config);
            this.sourceMap[name] = source;
            return source;
        });
    }
    getSource(nvim, name) {
        return __awaiter(this, void 0, void 0, function* () {
            let source = this.sourceMap[name];
            if (source)
                return source;
            // make vim source the file first time loaded, so we can check function
            let { pathMap } = this;
            source = yield this.createSource(nvim, name);
            return source;
        });
    }
}
exports.Remotes = Remotes;
exports.default = new Remotes();
//# sourceMappingURL=remotes.js.map