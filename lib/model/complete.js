"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fuzzaldrin_1 = require("fuzzaldrin");
const config_1 = require("../config");
const sorter_1 = require("../util/sorter");
const unique_1 = require("../util/unique");
const filter_1 = require("../util/filter");
const Serial = require("node-serial");
const logger = require('../util/logger')('model-complete');
const MAX_ITEM_COUNT = 300;
class Complete {
    constructor(opts) {
        this.option = opts;
        this.icase = true;
        this.recentScores = {};
    }
    completeSource(source) {
        let { engross, isOnly, firstMatch } = source;
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
                if (engross
                    || result.startcol && result.startcol != col) {
                    result.engross = true;
                }
                if (result == null) {
                    result = { items: [] };
                }
                result.only = isOnly;
                result.source = source.name;
                result.firstMatch = firstMatch;
                if (source.noinsert)
                    result.noinsert = true;
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
    filterResults(results, icase) {
        let arr = [];
        let only = this.getOnlySourceName(results);
        let { input, id } = this.option;
        let fuzzy = config_1.getConfig('fuzzyMatch');
        let filter = fuzzy ? filter_1.filterFuzzy : filter_1.filterWord;
        let count = 0;
        for (let i = 0, l = results.length; i < l; i++) {
            let res = results[i];
            let { items, source, noinsert, firstMatch } = res;
            if (firstMatch && input.length == 0)
                break;
            if (count != 0 && source == only)
                break;
            for (let item of items) {
                let { word, abbr, user_data } = item;
                let verb = abbr ? abbr : word;
                let data = {};
                if (input.length && !filter(input, verb, icase))
                    continue;
                if (user_data) {
                    try {
                        data = JSON.parse(user_data);
                    }
                    catch (e) { } // tslint:disable-line
                }
                data = Object.assign(data, { cid: id, source });
                item.user_data = JSON.stringify(data);
                if (noinsert)
                    item.noinsert = true;
                if (fuzzy)
                    item.score = fuzzaldrin_1.score(verb, input) + this.getBonusScore(item);
                arr.push(item);
                count = count + 1;
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
            let { col, input } = opts;
            sources.sort((a, b) => b.priority - a.priority);
            let results = yield Promise.all(sources.map(s => this.completeSource(s)));
            results = results.filter(r => {
                // error source
                if (r === false)
                    return false;
                if (r == null)
                    return false;
                return r.items && r.items.length > 0;
            });
            logger.debug(`Results from sources: ${results.map(s => s.source).join(',')}`);
            let engrossResult = results.find(r => r.engross === true);
            if (engrossResult) {
                if (engrossResult.startcol != null) {
                    col = engrossResult.startcol;
                }
                results = [engrossResult];
                logger.debug(`Engross source ${engrossResult.source} activted`);
            }
            // logger.debug(`resultes: ${JSON.stringify(results)}`)
            // use it even it's bad
            this.results = results;
            this.startcol = col;
            let icase = this.icase = !/[A-Z]/.test(input);
            let filteredResults = this.filterResults(results, icase);
            logger.debug(`Filtered items: ${JSON.stringify(filteredResults, null, 2)}`);
            return [col, filteredResults];
        });
    }
    getOnlySourceName(results) {
        let r = results.find(r => !!r.only);
        return r ? r.source : '';
    }
    getBonusScore(item) {
        let { word, abbr, kind, info } = item;
        let score = this.recentScores[word || abbr] || 0;
        score += kind ? 0.1 : 0;
        score += abbr ? 0.001 : 0;
        score += info ? 0.001 : 0;
        return score;
    }
}
exports.default = Complete;
//# sourceMappingURL=complete.js.map