"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const logger_1 = require("../util/logger");
const buffers_1 = require("../buffers");
const config_1 = require("../config");
const fuzzaldrin_1 = require("fuzzaldrin");
const sorter_1 = require("../util/sorter");
const unique_1 = require("../util/unique");
const fuzzysearch = require("fuzzysearch");
class Complete {
    constructor(opts) {
        let { bufnr, line, linenr, colnr, col, input, filetype, word } = opts;
        let buf = buffers_1.default.getBuffer(bufnr.toString());
        if (!buf) {
            this.id = '';
        }
        else {
            this.id = `${buf.hash}|${linenr}`;
        }
        this.word = word || '';
        this.bufnr = bufnr || '';
        this.linenr = linenr || 0;
        this.line = line || '';
        this.col = col || 0;
        this.colnr = colnr;
        this.input = input || '';
        this.filetype = filetype || '';
        this.fuzzy = config_1.getConfig('fuzzyMatch');
        this.finished = false;
    }
    getOption() {
        if (!this.id)
            return null;
        return {
            colnr: this.colnr,
            filetype: this.filetype,
            bufnr: this.bufnr,
            linenr: this.linenr,
            line: this.line,
            col: this.col,
            input: this.input,
            id: this.id,
            word: this.word,
        };
    }
    resuable(complete) {
        let { id, col, colnr, input, line, linenr } = complete;
        let same = id !== this.id;
        if (!id
            || id !== this.id
            || !this.results
            || linenr !== this.linenr
            || colnr < this.colnr
            || !input.startsWith(this.input)
            || line.slice(0, col) !== this.line.slice(0, col)
            || col !== this.col)
            return false;
        let buf = buffers_1.default.getBuffer(this.bufnr.toString());
        if (!buf)
            return false;
        let more = line.slice(col);
        return buf.isWord(more);
    }
    completeSource(source, opt) {
        return new Promise(resolve => {
            let called = false;
            let start = Date.now();
            source.doComplete(opt).then(result => {
                called = true;
                resolve(result);
                logger_1.logger.info(`Complete '${source.name}' takes ${Date.now() - start}ms`);
            }, error => {
                called = true;
                logger_1.logger.error(`Complete error of source '${source.name}'`);
                logger_1.logger.error(error.stack);
                resolve(null);
            });
            setTimeout(() => {
                if (!called) {
                    logger_1.logger.warn(`Complete source '${source.name}' too slow!`);
                    resolve(null);
                }
            }, config_1.getConfig('timeout'));
        });
    }
    filterResults(results, input, cword, isResume) {
        let arr = [];
        let { fuzzy } = this;
        let cFirst = input.length ? input[0].toLowerCase() : null;
        for (let i = 0, l = results.length; i < l; i++) {
            let res = results[i];
            if (res == null)
                continue;
            let { items, offsetLeft, offsetRight } = res;
            let hasOffset = !!offsetLeft || !!offsetRight;
            let user_data = hasOffset ? JSON.stringify({
                offsetLeft: offsetLeft || 0,
                offsetRight: offsetRight || 0
            }) : null;
            for (let item of items) {
                let { word, kind, info } = item;
                if (!word || word.length <= 2)
                    continue;
                let first = word[0].toLowerCase();
                // first must match for no kind
                if (!kind && cFirst && cFirst !== first)
                    continue;
                if (!kind && input.length == 0)
                    continue;
                // filter unnecessary no kind results
                if (!kind && !isResume && (word == cword || word == input))
                    continue;
                if (input.length && !fuzzysearch(input, word))
                    continue;
                if (user_data)
                    item.user_data = user_data;
                if (fuzzy)
                    item.score = fuzzaldrin_1.score(word, input) + (kind || info ? 0.01 : 0);
                arr.push(item);
            }
        }
        if (fuzzy) {
            arr.sort((a, b) => {
                return b.score - a.score;
            });
        }
        else {
            arr = sorter_1.wordSortItems(arr, input);
        }
        return unique_1.uniqueItems(arr);
    }
    doComplete(sources) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let opts = this.getOption();
            if (opts === null)
                return [];
            sources.sort((a, b) => b.priority - a.priority);
            let valids = [];
            for (let s of sources) {
                let shouldRun = yield s.shouldComplete(opts);
                if (!shouldRun)
                    continue;
                valids.push(s);
            }
            if (valids.length == 0) {
                logger_1.logger.debug('No source to complete');
                return [];
            }
            let engrossIdx = valids.findIndex(s => s.engross === true);
            logger_1.logger.debug(`Working sources: ${valids.map(s => s.name).join(',')}`);
            let results = yield Promise.all(valids.map(s => this.completeSource(s, opts)));
            this.finished = results.indexOf(null) == -1;
            results = results.filter(r => r !== null);
            if (engrossIdx && results[engrossIdx]) {
                let { items } = results[engrossIdx];
                if (items.length)
                    results = [results[engrossIdx]];
            }
            // reuse it even it's bad
            this.results = results;
            let { input, word } = this;
            return this.filterResults(results, input, word, false);
        });
    }
}
exports.default = Complete;
//# sourceMappingURL=complete.js.map