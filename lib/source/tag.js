"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = require("../util/fs");
const source_1 = require("../model/source");
const unique_1 = require("../util/unique");
const path = require("path");
const logger = require('../util/logger')('source-tag');
let TAG_CACHE = {};
class Tag extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'tag',
            shortcut: 'T',
            priority: 3,
            maxLineCount: 10000,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            let files = yield this.nvim.call('tagfiles');
            let cwd = yield this.nvim.call('getcwd');
            files = files.map(f => {
                return path.isAbsolute(f) ? f : path.join(cwd, f);
            });
            let tagfiles = [];
            for (let file of files) {
                let stat = yield fs_1.statAsync(file);
                if (!stat || !stat.isFile())
                    continue;
                tagfiles.push({ file, mtime: stat.mtime });
            }
            if (tagfiles.length === 0)
                return false;
            opt.tagfiles = tagfiles;
            return true;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            TAG_CACHE = {};
        });
    }
    loadTags(fullpath, mtime) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { maxLineCount } = this.config;
            let item = TAG_CACHE[fullpath];
            if (item && item.mtime >= mtime)
                return item.words;
            let words = [];
            yield fs_1.readFileByLine(fullpath, line => {
                if (line[0] == '!')
                    return;
                let ms = line.match(/^[^\t\s]+/);
                if (ms) {
                    let w = ms[0];
                    if (w.length > 2 && words.indexOf(w) === -1) {
                        words.push(w);
                    }
                }
            });
            TAG_CACHE[fullpath] = { words, mtime };
            return words;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { tagfiles } = opt;
            let list = yield Promise.all(tagfiles.map(o => this.loadTags(o.file, o.mtime)));
            let words = unique_1.uniqeWordsList(list);
            return {
                items: words.map(word => {
                    return {
                        word,
                        menu: this.menu
                    };
                })
            };
        });
    }
}
exports.default = Tag;
//# sourceMappingURL=tag.js.map