"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = require("../util/fs");
const source_1 = require("../model/source");
const fs = require("fs");
const path = require("path");
const pify = require("pify");
const logger = require('../util/logger')('source-word');
let items = null;
let file = path.resolve(__dirname, '../../data/emoji.txt');
class Emoji extends source_1.default {
    constructor(nvim) {
        super(nvim, {
            name: 'emoji',
            shortcut: 'EMO',
            priority: 0,
            filetypes: [],
            engross: 1,
        });
    }
    shouldComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.checkFileType(opt.filetype))
                return false;
            let { col, input } = opt;
            if (input.length === 0)
                return false;
            let stat = yield fs_1.statAsync(file);
            if (!stat || !stat.isFile())
                return false;
            let line = yield this.nvim.call('getline', ['.']);
            if (line[col] === ':') {
                opt.startcol = col;
                return true;
            }
            else if (line[col - 1] === ':') {
                opt.startcol = col - 1;
                return true;
            }
            return false;
        });
    }
    doComplete(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { col, input, startcol } = opt;
            if (!items) {
                let content = yield pify(fs.readFile)(file, 'utf8');
                let lines = content.split(/\n/);
                items = lines.map(str => {
                    let parts = str.split(':');
                    return { description: parts[0], character: parts[1] };
                });
            }
            let ch = input[0];
            let res = items.filter(o => {
                return o.description.indexOf(ch) !== -1;
            });
            return {
                startcol,
                items: res.map(o => {
                    return {
                        word: o.character,
                        abbr: `${o.character} ${o.description}`,
                        menu: this.menu
                    };
                })
            };
        });
    }
}
exports.default = Emoji;
//# sourceMappingURL=emoji.js.map