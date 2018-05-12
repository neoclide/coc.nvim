"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const fs_1 = require("../util/fs");
const matcher = require("matcher");
const path = require("path");
const unique = require("array-unique");
const pify = require("pify");
const fs = require("fs");
const logger = require('../util/logger')('source-file');
let pathRe = /((\.\.\/)+|\.\/|([a-z0-9_.@()-]+)?\/)([a-z0-9_.@()-]+\/)*[a-z0-9_.@()-]*$/;
class File extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'file',
            shortcut: 'F',
            priority: 2,
            engross: 1,
            trimSameExts: ['.ts', '.js'],
            ignoreHidden: true,
            ignorePatterns: [],
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { line, colnr, bufnr } = opt;
            let part = line.slice(0, colnr - 1);
            if (!part)
                return false;
            let ms = part.match(pathRe);
            if (ms) {
                opt.pathstr = ms[0];
                let fullpath = opt.fullpath = yield this.nvim.call('coc#util#get_fullpath', [Number(bufnr)]);
                opt.cwd = yield this.nvim.call('getcwd', []);
                opt.ext = fullpath ? path.extname(path.basename(fullpath)) : '';
                return true;
            }
            return false;
        });
    }
    getFileItem(root, filename, ext, trimExt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let f = path.join(root, filename);
            let stat = yield fs_1.statAsync(f);
            if (stat) {
                if (ext == path.extname(filename) && trimExt) {
                    filename = filename.slice(0, -ext.length);
                }
                return {
                    word: filename + (stat.isDirectory() ? '/' : '')
                };
            }
            return null;
        });
    }
    filterFiles(files) {
        let { ignoreHidden, ignorePatterns } = this.config;
        logger.debug('patterns');
        logger.debug(ignorePatterns);
        return files.filter(f => {
            if (f == null)
                return false;
            if (ignoreHidden && /^\./.test(f))
                return false;
            for (let p of ignorePatterns) {
                if (matcher.isMatch(f, p))
                    return false;
            }
            return true;
        });
    }
    getItemsFromRoots(pathstr, roots, ext) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let res = [];
            let trimExt = (this.config.trimSameExts || []).indexOf(ext) != -1;
            let part = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr);
            for (let root of roots) {
                let dir = path.join(root, part).replace(/\/$/, '');
                let stat = yield fs_1.statAsync(dir);
                if (stat && stat.isDirectory()) {
                    let files = yield pify(fs.readdir)(dir);
                    files = this.filterFiles(files);
                    let items = yield Promise.all(files.map(filename => {
                        return this.getFileItem(dir, filename, ext, trimExt);
                    }));
                    res = res.concat(items);
                }
            }
            res = res.filter(item => item != null);
            return res;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { pathstr, fullpath, cwd, ext } = opt;
            let roots = [];
            if (!fullpath) {
                roots = [path.join(cwd, 'src'), cwd];
            }
            else if (/^\./.test(pathstr)) {
                roots = [path.dirname(fullpath)];
            }
            else if (/^\//.test(pathstr)) {
                roots = ['/'];
            }
            else {
                roots = [fs_1.findSourceDir(fullpath) || cwd];
            }
            roots = roots.filter(r => typeof r === 'string');
            roots = unique(roots);
            let items = yield this.getItemsFromRoots(pathstr, roots, ext);
            let trimExt = this.config.trimSameExts.indexOf(ext) != -1;
            return {
                items: items.map(item => {
                    let ex = path.extname(item.word);
                    item.word = trimExt && ex === ext ? item.word.replace(ext, '') : item.word;
                    return Object.assign({}, item, { menu: this.menu });
                })
            };
        });
    }
}
exports.default = File;
//# sourceMappingURL=file.js.map