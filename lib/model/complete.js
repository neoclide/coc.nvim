"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fuzzaldrin_1 = require("fuzzaldrin");
const config_1 = require("../config");
const sorter_1 = require("../util/sorter");
const unique_1 = require("../util/unique");
const index_1 = require("../util/index");
const string_1 = require("../util/string");
const fuzzy_1 = require("../util/fuzzy");
const Serial = require("node-serial");
const logger = require('../util/logger')('model-complete');
const MAX_ITEM_COUNT = 300;
class Complete {
    constructor(opts) {
        this.option = opts;
        this.recentScores = {};
    }
    completeSource(source) {
        let { engross, firstMatch } = source;
        let start = Date.now();
        let s = new Serial();
        let { col } = this.option;
        // new option for each source
        let option = Object.assign({}, this.option);
        s.timeout(Math.max(config_1.getConfig('timeout'), 300));
        s.add((done, ctx) => {
            source.shouldComplete(option).then(res => {
                ctx.shouldRun = res;
                done();
            }, done);
        });
        s.add((done, ctx) => {
            if (!ctx.shouldRun) {
                logger.debug(`Source ${source.name} skipped`);
                return done();
            }
            source.doComplete(option).then(result => {
                if (result == null) {
                    result = { items: [] };
                }
                if (engross
                    || result.startcol && result.startcol != col) {
                    result.engross = true;
                }
                result.filter = source.filter;
                result.priority = source.priority;
                result.source = source.name;
                result.firstMatch = firstMatch;
                ctx.result = result;
                done();
            }, done);
        });
        return new Promise(resolve => {
            s.done((err, ctx) => {
                if (err) {
                    logger.error(`Complete error of source '${source.name}'`);
                    logger.error(err.stack);
                    resolve(false);
                    return;
                }
                if (ctx.result) {
                    logger.info(`Complete '${source.name}' takes ${Date.now() - start}ms`);
                }
                resolve(ctx.result || null);
            });
        });
    }
    checkResult(result, opt) {
        let { items, firstMatch, filter, startcol } = result;
        if (!items || items.length == 0)
            return false;
        let { line, colnr, col } = opt;
        let input = result.input || opt.input;
        if (startcol && startcol != col) {
            input = string_1.byteSlice(line, startcol, colnr - 1);
        }
        let field = filter || 'word';
        let fuzzy = config_1.getConfig('fuzzyMatch');
        let codes = fuzzy ? fuzzy_1.getCharCodes(input) : [];
        return items.some(item => {
            let s = item[field];
            if (firstMatch && s[0] !== input[0])
                return false;
            if (fuzzy)
                return fuzzy_1.fuzzyMatch(codes, s);
            return index_1.filterWord(input, s, !/A-Z/.test(input));
        });
    }
    filterResults(results) {
        let arr = [];
        let { input, id } = this.option;
        let fuzzy = config_1.getConfig('fuzzyMatch');
        let codes = fuzzy ? fuzzy_1.getCharCodes(input) : [];
        let filter = fuzzy ? (_, verb) => {
            return fuzzy_1.fuzzyMatch(codes, verb);
        } : (input, verb) => {
            return index_1.filterWord(input, verb, !/A-Z/.test(input));
        };
        for (let i = 0, l = results.length; i < l; i++) {
            let res = results[i];
            let filterField = res.filter || 'word';
            let { items, source, firstMatch } = res;
            if (firstMatch && input.length == 0)
                break;
            for (let item of items) {
                let { word, abbr, user_data } = item;
                let verb = filterField == 'abbr' ? abbr : word;
                let data = {};
                if (input.length && !filter(input, verb))
                    continue;
                if (user_data) {
                    try {
                        data = JSON.parse(user_data);
                    }
                    catch (e) { } // tslint:disable-line
                }
                data = Object.assign(data, { cid: id, source, filter: filterField });
                item.user_data = JSON.stringify(data);
                if (fuzzy)
                    item.score = fuzzaldrin_1.score(verb, input) + this.getBonusScore(input, item);
                arr.push(item);
            }
        }
        if (fuzzy) {
            arr.sort((a, b) => b.score - a.score);
        }
        else {
            arr = sorter_1.wordSortItems(arr, input);
        }
        arr = arr.slice(0, MAX_ITEM_COUNT);
        return unique_1.uniqueItems(arr);
    }
    doComplete(sources) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let opts = this.option;
            let { col, line, colnr } = opts;
            sources.sort((a, b) => b.priority - a.priority);
            let results = yield Promise.all(sources.map(s => this.completeSource(s)));
            results = results.filter(r => {
                // error source
                if (r === false)
                    return false;
                if (r == null)
                    return false;
                return this.checkResult(r, opts);
            });
            logger.debug(`Results from sources: ${results.map(s => s.source).join(',')}`);
            if (results.length == 0)
                return [col, []];
            let engrossResult = results.find(r => r.engross === true);
            if (engrossResult) {
                let { startcol } = engrossResult;
                if (startcol && startcol != col) {
                    col = engrossResult.startcol;
                    opts.col = col;
                    opts.input = string_1.byteSlice(line, startcol, colnr - 1);
                }
                results = [engrossResult];
                logger.debug(`Engross source ${engrossResult.source} activted`);
            }
            let priority = results[0].priority;
            results = results.filter(r => r.priority === priority);
            this.results = results;
            this.startcol = col;
            let filteredResults = this.filterResults(results);
            logger.debug(`Filtered items: ${JSON.stringify(filteredResults, null, 2)}`);
            return [col, filteredResults];
        });
    }
    getBonusScore(input, item) {
        let { word, abbr, kind, info } = item;
        let key = `${input.slice(0, 3)}|${word}`;
        let score = this.recentScores[key] || 0;
        score += (input && word[0] == input[0]) ? 0.001 : 0;
        score += kind ? 0.001 : 0;
        score += abbr ? 0.001 : 0;
        score += info ? 0.001 : 0;
        return score;
    }
}
exports.default = Complete;
//# sourceMappingURL=complete.js.map