"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = tslib_1.__importDefault(require("fs"));
const minimatch_1 = tslib_1.__importDefault(require("minimatch"));
const os_1 = tslib_1.__importDefault(require("os"));
const path_1 = tslib_1.__importDefault(require("path"));
const util_1 = tslib_1.__importDefault(require("util"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const source_1 = tslib_1.__importDefault(require("../model/source"));
const fs_2 = require("../util/fs");
const string_1 = require("../util/string");
const logger = require('../util/logger')('source-file');
const pathRe = /(?:\.{0,2}|~|([\w.@()-]+))\/(?:[\w.@()-]+\/)*(?:[\w.@()-])*$/;
class File extends source_1.default {
    constructor() {
        super({
            name: 'file',
            filepath: __filename
        });
    }
    getPathOption(opt) {
        let { line, colnr } = opt;
        let part = string_1.byteSlice(line, 0, colnr - 1);
        if (!part || part.slice(-2) == '//')
            return null;
        let ms = part.match(pathRe);
        if (ms && ms.length) {
            let pathstr = ms[0];
            if (pathstr.startsWith('~')) {
                pathstr = os_1.default.homedir() + pathstr.slice(1);
            }
            let input = ms[0].match(/[^/]*$/)[0];
            return { pathstr, part: ms[1], startcol: colnr - input.length - 1, input };
        }
        return null;
    }
    async getFileItem(root, filename) {
        let f = path_1.default.join(root, filename);
        let stat = await fs_2.statAsync(f);
        if (stat) {
            let abbr = stat.isDirectory() ? filename + '/' : filename;
            let word = filename;
            return { word, abbr };
        }
        return null;
    }
    filterFiles(files) {
        let ignoreHidden = this.getConfig('ignoreHidden', true);
        let ignorePatterns = this.getConfig('ignorePatterns', []);
        return files.filter(f => {
            if (f == null)
                return false;
            if (ignoreHidden && /^\./.test(f))
                return false;
            for (let p of ignorePatterns) {
                if (minimatch_1.default(f, p, { dot: true }))
                    return false;
            }
            return true;
        });
    }
    async getItemsFromRoot(pathstr, root) {
        let res = [];
        let part = /\/$/.test(pathstr) ? pathstr : path_1.default.dirname(pathstr);
        let dir = path_1.default.isAbsolute(pathstr) ? part : path_1.default.join(root, part);
        let stat = await fs_2.statAsync(dir);
        if (stat && stat.isDirectory()) {
            let files = await util_1.default.promisify(fs_1.default.readdir)(dir);
            files = this.filterFiles(files);
            let items = await Promise.all(files.map(filename => {
                return this.getFileItem(dir, filename);
            }));
            res = res.concat(items);
        }
        res = res.filter(item => item != null);
        return res;
    }
    get trimSameExts() {
        return this.getConfig('trimSameExts', []);
    }
    async doComplete(opt) {
        let { col, filepath } = opt;
        let option = this.getPathOption(opt);
        if (!option)
            return null;
        let { pathstr, part, startcol, input } = option;
        let dirname = path_1.default.dirname(filepath);
        let ext = path_1.default.extname(path_1.default.basename(filepath));
        let cwd = await this.nvim.call('getcwd', []);
        let root;
        if (/^\./.test(pathstr)) {
            root = filepath ? path_1.default.dirname(filepath) : cwd;
        }
        else if (/^\//.test(pathstr)) {
            root = /\/$/.test(pathstr) ? pathstr : path_1.default.dirname(pathstr);
        }
        else if (part) {
            if (fs_1.default.existsSync(path_1.default.join(dirname, part))) {
                root = dirname;
            }
            else if (fs_1.default.existsSync(path_1.default.join(cwd, part))) {
                root = cwd;
            }
        }
        else {
            root = cwd;
        }
        if (!root)
            return null;
        let items = await this.getItemsFromRoot(pathstr, root);
        let trimExt = this.trimSameExts.indexOf(ext) != -1;
        let first = input[0];
        if (first && col == startcol)
            items = items.filter(o => o.word[0] === first);
        return {
            startcol,
            items: items.map(item => {
                let ex = path_1.default.extname(item.word);
                item.word = trimExt && ex === ext ? item.word.replace(ext, '') : item.word;
                return Object.assign({}, item, { menu: this.menu });
            })
        };
    }
}
exports.default = File;
function regist(sourceMap) {
    sourceMap.set('file', new File());
    return vscode_languageserver_protocol_1.Disposable.create(() => {
        sourceMap.delete('file');
    });
}
exports.regist = regist;
//# sourceMappingURL=file.js.map