"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const index_1 = require("../util/index");
const config_1 = require("../config");
const config_2 = require("../config");
const filter_1 = require("../util/filter");
const logger = require('../util/logger')('model-source');
class Source {
    constructor(nvim, option) {
        let { name, optionalFns, noinsert } = option;
        delete option.name;
        delete option.optionalFns;
        delete option.noinsert;
        this.nvim = nvim;
        this.optionalFns = optionalFns || [];
        this.noinsert = noinsert;
        this.name = name;
        option.engross = !!option.engross;
        // user options
        let opt = config_2.getSourceConfig(name) || {};
        this.config = Object.assign({
            shortcut: name.slice(0, 3),
            priority: 0,
            engross: false,
            filetypes: null
        }, option, opt);
    }
    get priority() {
        return Number(this.config.priority);
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
        let fuzzy = config_1.getConfig('fuzzyMatch');
        let res = [];
        let { input } = opt;
        let cword = opt.word;
        let cFirst = input.length ? input[0] : null;
        let icase = !/[A-Z]/.test(input);
        let filter = fuzzy ? filter_1.filterFuzzy : filter_1.filterWord;
        for (let word of words) {
            if (!cFirst)
                continue;
            if (!word || word.length < 3)
                continue;
            if (cFirst && !index_1.equalChar(word[0], cFirst, icase))
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
}
exports.default = Source;
//# sourceMappingURL=source.js.map