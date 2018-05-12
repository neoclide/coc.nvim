"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const source_1 = require("../model/source");
const fs_1 = require("../util/fs");
const path = require("path");
const unique = require("array-unique");
const pify = require("pify");
const fs = require("fs");
const logger = require('../util/logger')('source-file');
let pathRe = /((\.\.\/)+|\.\/|([a-z0-9_.@()-]+)?\/)([a-z0-9_.@()-]+\/)*[a-z0-9_.@()-]*$/;
// from current file  => src of current cwd => current cwd
class Around extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'file',
            shortcut: 'F',
            priority: 2,
            engross: 1,
        });
        this.trimSameExts = ['.ts', '.js'];
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
                opt.fullpath = yield this.nvim.call('coc#util#get_fullpath', [Number(bufnr)]);
                logger.debug(opt.fullpath);
                opt.cwd = yield this.nvim.call('getcwd', []);
            }
            return ms != null;
        });
    }
    getFileItem(root, filename) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let f = path.join(root, filename);
            let stat = yield fs_1.statAsync(f);
            if (stat) {
                return {
                    word: filename + (stat.isDirectory() ? '/' : '')
                };
            }
            return null;
        });
    }
    getItemsFromRoots(pathstr, roots) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let res = [];
            let part = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr);
            for (let root of roots) {
                let dir = path.join(root, part).replace(/\/$/, '');
                let stat = yield fs_1.statAsync(dir);
                if (stat && stat.isDirectory()) {
                    let files = yield pify(fs.readdir)(dir);
                    files = files.filter(f => !/^\./.test(f));
                    let items = yield Promise.all(files.map(filename => {
                        return this.getFileItem(dir, filename);
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
            let { pathstr, fullpath, cwd } = opt;
            let roots = [];
            if (/^\./.test(pathstr)) {
                roots = fullpath ? [path.dirname(fullpath)] : [path.join(cwd, 'src'), cwd];
            }
            else if (/^\//.test(pathstr)) {
                roots = ['/'];
            }
            else {
                roots = [path.join(cwd, 'src'), cwd];
            }
            roots = roots.filter(r => r != null);
            roots = unique(roots);
            let items = yield this.getItemsFromRoots(pathstr, roots);
            let ext = fullpath ? path.extname(path.basename(fullpath)) : '';
            let trimExt = this.trimSameExts.indexOf(ext) != -1;
            logger.debug(ext);
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
exports.default = Around;
//# sourceMappingURL=file.js.map