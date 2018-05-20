"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("../config");
const fuzzy_1 = require("../util/fuzzy");
const logger = require('../util/logger')('model-source');
class Source {
    constructor(nvim, option) {
        let { name, optionalFns, only } = option;
        delete option.name;
        delete option.optionalFns;
        this.nvim = nvim;
        this.optionalFns = optionalFns || [];
        this.name = name;
        ['engross', 'noinsert', 'firstMatch'].forEach(name => {
            option[name] = option[name] == '0' ? false : !!option[name];
        });
        // user options
        let opt = config_1.getSourceConfig(name) || {};
        this.config = Object.assign({
            shortcut: name.slice(0, 3),
            priority: 0,
            engross: false,
            filetypes: null,
            noinsert: false,
            firstMatch: false
        }, option, opt);
        if (only)
            this.config.priority = 0;
    }
    get priority() {
        return Number(this.config.priority);
    }
    get noinsert() {
        return !!this.config.noinsert;
    }
    get firstMatch() {
        return !!this.config.firstMatch;
    }
    get isOnly() {
        return this.config.only === true ? true : false;
    }
    get engross() {
        return !!this.config.engross;
    }
    get filetypes() {
        return this.config.filetypes;
    }
    get menu() {
        let { shortcut } = this.config;
        return `[${shortcut.slice(0, 3).toUpperCase()}]`;
    }
    convertToItems(list, extra = {}) {
        let { menu } = this;
        let res = [];
        for (let item of list) {
            if (typeof item == 'string') {
                res.push(Object.assign({ word: item, menu }, extra));
            }
            if (item.hasOwnProperty('word')) {
                if (item.menu)
                    extra.info = item.menu;
                res.push(Object.assign(item, { menu }, extra));
            }
        }
        return res;
    }
    filterWords(words, opt) {
        let res = [];
        let { input } = opt;
        let cword = opt.word;
        let cFirst = input.length ? input[0] : null;
        for (let word of words) {
            if (!cFirst)
                continue;
            if (!word || word.length < 3)
                continue;
            if (cFirst && !fuzzy_1.fuzzyChar(cFirst, word[0]))
                continue;
            if (word == cword || word == input)
                continue;
            res.push(word);
        }
        return res;
    }
    checkFileType(filetype) {
        if (this.filetypes == null)
            return true;
        return this.filetypes.indexOf(filetype) !== -1;
    }
    // some source could overwrite it
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // do nothing
        });
    }
    onCompleteDone(item) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // do nothing
        });
    }
}
exports.default = Source;
//# sourceMappingURL=source.js.map