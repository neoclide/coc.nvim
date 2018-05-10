"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fuzzaldrin_1 = require("fuzzaldrin");
const buffers_1 = require("../buffers");
const config_1 = require("../config");
const logger_1 = require("../util/logger");
const sorter_1 = require("../util/sorter");
const index_1 = require("../util/index");
const unique_1 = require("../util/unique");
const filter_1 = require("../util/filter");
class Complete {
    constructor(opts) {
        this.finished = false;
        this.option = opts;
    }
    resuable(complete) {
        let { col, colnr, input, line, linenr } = complete.option;
        if (!this.results
            || linenr !== this.option.linenr
            || colnr < this.option.colnr
            || !input.startsWith(this.option.input)
            || line.slice(0, col) !== this.option.line.slice(0, col)
            || col !== this.option.col)
            return false;
        let buf = buffers_1.default.getBuffer(this.option.bufnr.toString());
        if (!buf)
            return false;
        let more = line.slice(col);
        return buf.isWord(more);
    }
    completeSource(source, opt) {
        let { engross } = source;
        return new Promise(resolve => {
            let called = false;
            let start = Date.now();
            source.doComplete(opt).then(result => {
                called = true;
                if (engross
                    && result != null
                    && result.items
                    && result.items.length) {
                    result.engross = true;
                }
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
    filterResults(results, isResume) {
        let arr = [];
        let { input, id } = this.option;
        let cword = this.option.word;
        let fuzzy = config_1.getConfig('fuzzyMatch');
        let cFirst = input.length ? input[0] : null;
        let filter = fuzzy ? filter_1.filterFuzzy : filter_1.filterWord;
        let icase = !/[A-Z]/.test(input);
        for (let i = 0, l = results.length; i < l; i++) {
            let res = results[i];
            if (res == null)
                continue;
            let { items } = res;
            for (let item of items) {
                let { word, kind, abbr, info, user_data } = item;
                let data = {};
                if (!word || word.length < 3)
                    continue;
                if (!kind && cFirst && !index_1.equalChar(word[0], cFirst, icase))
                    continue;
                if (!kind && !abbr && !info && input.length == 0)
                    continue;
                // filter unnecessary no kind results
                if (!kind && !isResume && (word == cword || word == input))
                    continue;
                if (input.length && !filter(input, word, icase))
                    continue;
                if (user_data) {
                    try {
                        data = JSON.parse(user_data);
                    }
                    catch (e) { } // tslint:disable-line
                }
                data = Object.assign(data, {
                    id,
                    source: 'complete'
                });
                item.user_data = JSON.stringify(data);
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
            let opts = this.option;
            let { col } = opts;
            let valids = [];
            for (let s of sources) {
                let shouldRun = yield s.shouldComplete(opts);
                if (!shouldRun)
                    continue;
                valids.push(s);
            }
            if (valids.length == 0) {
                logger_1.logger.debug('No source to complete');
                return [col, []];
            }
            valids.sort((a, b) => b.priority - a.priority);
            logger_1.logger.debug(`Working sources: ${valids.map(s => s.name).join(',')}`);
            let results = yield Promise.all(valids.map(s => this.completeSource(s, opts)));
            this.finished = results.indexOf(null) == -1;
            results = results.filter(r => {
                return r != null && r.items && r.items.length;
            });
            let engrossResult = results.find(r => r.engross === true);
            if (engrossResult) {
                if (engrossResult.startcol != null) {
                    col = engrossResult.startcol;
                }
                results = [engrossResult];
                logger_1.logger.debug(`Engross source activted`);
            }
            // reuse it even it's bad
            this.results = results;
            logger_1.logger.debug(JSON.stringify(results));
            let filteredResults = this.filterResults(results, false);
            logger_1.logger.debug(JSON.stringify(filteredResults));
            return [col, filteredResults];
        });
    }
}
exports.default = Complete;
//# sourceMappingURL=complete.js.map