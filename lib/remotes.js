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
        this.list = [];
    }
    get names() {
        return this.list.map(o => o.name);
    }
    has(name) {
        return this.list.findIndex(o => o.name == name) !== -1;
    }
    getFilepath(name) {
        let remote = this.list.find(o => o.name == name);
        return remote ? remote.filepath : null;
    }
    init(nvim, isCheck) {
        return __awaiter(this, void 0, void 0, function* () {
            let runtimepath = yield nvim.eval('&runtimepath');
            let paths = runtimepath.split(',');
            let { list } = this;
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
                                let valid = yield this.checkSource(nvim, name, fullpath, isCheck);
                                if (valid) {
                                    logger_1.logger.debug(`Source ${name} verified: ${fullpath}`);
                                    this.list.push({
                                        name,
                                        filepath: fullpath,
                                        instance: null
                                    });
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
        });
    }
    reportError(nvim, name, msg, fullpath) {
        return __awaiter(this, void 0, void 0, function* () {
            let path = fullpath || this.getFilepath(name);
            yield nvim.call('health#report_error', [`${name} source error: ${msg}`,
                path ? [`Check the file ${fullpath}`, 'report error to author!'] : []
            ]);
        });
    }
    checkSource(nvim, name, fullpath, isCheck) {
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
                        yield this.reportError(nvim, name, msg, fullpath);
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
            let source = new source_vim_1.default(nvim, Object.assign({}, config, { name }));
            return source;
        });
    }
    getSource(nvim, name) {
        return __awaiter(this, void 0, void 0, function* () {
            let remote = this.list.find(o => o.name == name);
            if (!remote) {
                logger_1.logger.error(`Remote source ${name} not found`);
                return null;
            }
            if (remote.instance)
                return remote.instance;
            let source = yield this.createSource(nvim, name);
            remote.instance = source;
            return source;
        });
    }
}
exports.Remotes = Remotes;
exports.default = new Remotes();
//# sourceMappingURL=remotes.js.map