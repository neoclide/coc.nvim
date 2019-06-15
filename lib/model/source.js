"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const types_1 = require("../types");
const string_1 = require("../util/string");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('model-source');
class Source {
    constructor(option) {
        this._disabled = false;
        this.nvim = workspace_1.default.nvim;
        // readonly properties
        this.name = option.name;
        this.filepath = option.filepath || '';
        this.sourceType = option.sourceType || types_1.SourceType.Native;
        this.isSnippet = !!option.isSnippet;
        this.defaults = option;
    }
    get priority() {
        return this.getConfig('priority', 1);
    }
    get triggerOnly() {
        let triggerOnly = this.defaults['triggerOnly'];
        if (typeof triggerOnly == 'boolean')
            return triggerOnly;
        if (!this.triggerCharacters && !this.triggerPatterns)
            return false;
        return Array.isArray(this.triggerPatterns) && this.triggerPatterns.length != 0;
    }
    get triggerCharacters() {
        return this.getConfig('triggerCharacters', null);
    }
    // exists opitonnal function names for remote source
    get optionalFns() {
        return this.defaults['optionalFns'] || [];
    }
    get triggerPatterns() {
        let patterns = this.getConfig('triggerPatterns', null);
        if (!patterns || patterns.length == 0)
            return null;
        return patterns.map(s => {
            return (typeof s === 'string') ? new RegExp(s + '$') : s;
        });
    }
    get shortcut() {
        let shortcut = this.getConfig('shortcut', '');
        return shortcut ? shortcut : this.name.slice(0, 3);
    }
    get enable() {
        if (this._disabled)
            return false;
        return this.getConfig('enable', true);
    }
    get filetypes() {
        return this.getConfig('filetypes', null);
    }
    get disableSyntaxes() {
        return this.getConfig('disableSyntaxes', []);
    }
    getConfig(key, defaultValue) {
        let config = workspace_1.default.getConfiguration(`coc.source.${this.name}`);
        defaultValue = this.defaults.hasOwnProperty(key) ? this.defaults[key] : defaultValue;
        return config.get(key, defaultValue);
    }
    toggle() {
        this._disabled = !this._disabled;
    }
    get firstMatch() {
        return this.getConfig('firstMatch', true);
    }
    get menu() {
        let { shortcut } = this;
        return shortcut ? `[${shortcut}]` : '';
    }
    /**
     * Filter words that too short or doesn't match input
     */
    filterWords(words, opt) {
        let res = [];
        let { input } = opt;
        let cword = opt.word;
        if (!input.length)
            return [];
        let cFirst = input[0];
        for (let word of words) {
            if (!word || word.length < 3)
                continue;
            if (cFirst && cFirst != word[0])
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
        opt.col = col;
        opt.input = input;
        return col;
    }
    async shouldComplete(opt) {
        let { disableSyntaxes } = this;
        let synname = opt.synname.toLowerCase();
        if (disableSyntaxes && disableSyntaxes.length && disableSyntaxes.findIndex(s => synname.indexOf(s.toLowerCase()) != -1) !== -1) {
            return false;
        }
        let fn = this.defaults['shouldComplete'];
        if (fn)
            return await Promise.resolve(fn.call(this, opt));
        return true;
    }
    async refresh() {
        let fn = this.defaults['refresh'];
        if (fn)
            await Promise.resolve(fn.call(this));
    }
    async onCompleteDone(item, opt) {
        let fn = this.defaults['onCompleteDone'];
        if (fn)
            await Promise.resolve(fn.call(this, item, opt));
    }
    async doComplete(opt, token) {
        let fn = this.defaults['doComplete'];
        if (fn)
            return await Promise.resolve(fn.call(this, opt, token));
        return null;
    }
}
exports.default = Source;
//# sourceMappingURL=source.js.map