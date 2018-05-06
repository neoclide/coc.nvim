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
const index_1 = require("./util/index");
const fs_1 = require("./util/fs");
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
    init(nvim, isCheck) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.initailized)
                return;
            let runtimepath = yield nvim.eval('&runtimepath');
            let paths = runtimepath.split(',');
            let { pathMap } = this;
            let dups = {};
            for (let p of paths) {
                let folder = path.join(p, 'autoload/complete/source');
                let stat = yield fs_1.statAsync(folder);
                if (stat && stat.isDirectory()) {
                    let files = yield pify(fs.readdir)(folder);
                    for (let f of files) {
                        if (!/\.vim$/.test(f))
                            continue;
                        let fullpath = path.join(folder, f);
                        let s = yield fs_1.statAsync(fullpath);
                        if (s && s.isFile()) {
                            let name = path.basename(f, '.vim');
                            if (this.names.indexOf(name) !== -1) {
                                if (isCheck) {
                                    let paths = dups[name] || [];
                                    paths.push(fullpath);
                                    dups[name] = paths;
                                }
                                else {
                                    index_1.echoWarning(nvim, `source ${name} found in multiple runtimes, run ':checkhealth' for detail`);
                                }
                            }
                            else {
                                try {
                                    yield nvim.command(`source ${fullpath}`);
                                }
                                catch (e) {
                                    if (isCheck) {
                                        yield this.reportError(nvim, name, `vim script error ${e.message}`, fullpath);
                                    }
                                    else {
                                        index_1.echoErr(nvim, `Vim error from ${name} source: ${e.message}`);
                                    }
                                    continue;
                                }
                                let valid = yield this.checkSource(nvim, name, isCheck);
                                if (valid) {
                                    pathMap[name] = fullpath;
                                    logger_1.logger.debug(`Source ${name} verified: ${fullpath}`);
                                }
                            }
                        }
                    }
                }
                if (isCheck) {
                    for (let name of Object.keys(dups)) {
                        let paths = dups[name];
                        yield nvim.call('health#report_warn', [
                            `Same source ${name} found in multiple runtimes`,
                            ['Consider remove the duplicates: '].concat(paths)
                        ]);
                    }
                    yield nvim.call('health#report_info', [`Activted vim sources: ${this.names.join(',')}`]);
                }
            }
            this.initailized = true;
        });
    }
    reportError(nvim, name, msg, fullpath) {
        return __awaiter(this, void 0, void 0, function* () {
            let path = fullpath || this.pathMap[name];
            yield nvim.call('health#report_error', [`${name} source error: ${msg}`,
                [`Check the file ${fullpath}`, 'report error to author!']
            ]);
        });
    }
    checkSource(nvim, name, isCheck) {
        return __awaiter(this, void 0, void 0, function* () {
            let fns = ['init', 'complete'];
            let valid = true;
            for (let fname of fns) {
                let fn = `complete#source#${name}#${fname}`;
                let exists = yield nvim.call('exists', [`*${fn}`]);
                if (exists != 1) {
                    valid = false;
                    let msg = `Function ${fname} not found for '${name}' source`;
                    if (isCheck) {
                        yield this.reportError(nvim, name, msg);
                    }
                    else {
                        yield index_1.echoErr(nvim, msg);
                    }
                }
            }
            return valid;
        });
    }
    createSource(nvim, name, isCheck) {
        return __awaiter(this, void 0, void 0, function* () {
            let fn = `complete#source#${name}#init`;
            let config;
            try {
                config = yield nvim.call(fn, []);
            }
            catch (e) {
                if (isCheck) {
                    yield this.reportError(nvim, name, `vim script error on init ${e.message}`);
                }
                else {
                    index_1.echoErr(nvim, `Vim error on init from source ${name}: ${e.message}`);
                }
                return null;
            }
            let { filetypes, shortcut } = config;
            config.name = name;
            config.engross = !!config.engross;
            if (!Array.isArray(filetypes)) {
                config.filetypes = null;
            }
            if (!shortcut) {
                config.shortcut = name.slice(0, 3).toUpperCase();
            }
            else {
                config.shortcut = shortcut.slice(0, 3).toUpperCase();
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
            let { pathMap } = this;
            source = yield this.createSource(nvim, name);
            return source;
        });
    }
}
exports.Remotes = Remotes;
exports.default = new Remotes();
//# sourceMappingURL=remotes.js.map