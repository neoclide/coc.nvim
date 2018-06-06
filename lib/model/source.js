"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("../config");
const fuzzy_1 = require("../util/fuzzy");
const util_1 = require("../util");
const string_1 = require("../util/string");
const workspace_1 = require("../workspace");
const logger = require('../util/logger')('model-source');
const boolOptions = ['engross', 'firstmatch'];
class Source {
    constructor(nvim, option) {
        let { name, optionalFns } = option;
        delete option.name;
        delete option.optionalFns;
        this.nvim = nvim;
        this.optionalFns = optionalFns || [];
        this.name = name;
        for (let key of boolOptions) {
            if (option.hasOwnProperty(key)) {
                option[key] = util_1.toBool(option[key]);
            }
        }
        // user options
        let opt = config_1.getSourceConfig(name) || {};
        this.config = Object.assign({
            shortcut: name.slice(0, 3),
            priority: 0,
            filetypes: null,
            engross: false,
            firstMatch: false,
            filterAbbr: false,
            showSignature: true,
            bindKeywordprg: true,
            signatureEvents: config_1.getConfig('signatureEvents'),
        }, option, opt);
    }
    get priority() {
        return Number(this.config.priority);
    }
    get filter() {
        let { filterAbbr } = this.config;
        return filterAbbr ? 'abbr' : 'word';
    }
    get firstMatch() {
        return !!this.config.firstMatch;
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
    /**
     * fix start column for new valid characters
     *
     * @protected
     * @param {CompleteOption} opt
     * @param {string[]} valids - valid charscters
     * @returns {number}
     */
    fixStartcol(opt, valids) {
        let { col, input, line, bufnr } = opt;
        let start = string_1.byteSlice(line, 0, col);
        let document = workspace_1.default.getDocument(bufnr);
        if (!document)
            return col;
        let { chars } = document;
        for (let i = start.length - 1; i >= 0; i--) {
            let c = start[i];
            if (!chars.isKeywordChar(c) && valids.indexOf(c) === -1) {
                break;
            }
            input = `${c}${input}`;
            col = col - 1;
        }
        opt.input = input;
        return col;
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