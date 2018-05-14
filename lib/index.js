"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// umask is blacklisted by node-client
process.umask = () => {
    return 18;
};
const neovim_1 = require("neovim");
const index_1 = require("./util/index");
const config_1 = require("./config");
const buffers_1 = require("./buffers");
const completes_1 = require("./completes");
const remotes_1 = require("./remotes");
const natives_1 = require("./natives");
const remote_store_1 = require("./remote-store");
const increment_1 = require("./increment");
const logger = require('./util/logger')('index');
let CompletePlugin = class CompletePlugin {
    constructor(nvim) {
        this.nvim = nvim;
        this.debouncedOnChange = index_1.contextDebounce((bufnr) => {
            this.onBufferChange(bufnr).catch(e => {
                logger.error(e.message);
            });
            logger.debug(`buffer ${bufnr} change`);
        }, 500);
        this.increment = new increment_1.default(nvim);
        process.on('unhandledRejection', (reason, p) => {
            logger.error('Unhandled Rejection at:', p, 'reason:', reason);
            if (reason instanceof Error)
                this.handleError(reason);
        });
        process.on('uncaughtException', this.handleError.bind(this));
        this.handleError = this.handleError.bind(this);
    }
    handleError(err) {
        let { nvim } = this;
        index_1.echoErr(nvim, `Service error: ${err.message}`).catch(err => {
            logger.error(err.message);
        });
    }
    cocInitAsync() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.onInit().catch(err => {
                logger.error(err.stack);
            });
        });
    }
    cocInitSync() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.onInit();
        });
    }
    onInit() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            try {
                yield this.initConfig();
                yield natives_1.default.init();
                yield remotes_1.default.init(nvim, natives_1.default.names);
                yield nvim.command(`let g:coc_node_channel_id=${nvim._channel_id}`);
                yield nvim.command('silent doautocmd User CocNvimInit');
                logger.info('Coc service Initailized');
                // required since BufRead triggered before VimEnter
                let bufs = yield nvim.call('coc#util#get_buflist', []);
                for (let buf of bufs) {
                    yield buffers_1.default.addBuffer(nvim, buf.toString());
                }
            }
            catch (err) {
                logger.error(err.stack);
                return index_1.echoErr(nvim, `Initailize failed, ${err.message}`);
            }
        });
    }
    cocBufUnload(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            buffers_1.default.removeBuffer(bufnr);
            logger.debug(`buffer ${bufnr} remove`);
        });
    }
    cocBufChange(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            this.debouncedOnChange(bufnr);
        });
    }
    cocStart(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let opt = args[0];
            let start = Date.now();
            let { nvim, increment } = this;
            yield increment.stop();
            logger.debug(`options: ${JSON.stringify(opt)}`);
            let { filetype } = opt;
            let complete = completes_1.default.createComplete(opt);
            let sources = yield completes_1.default.getSources(nvim, filetype);
            complete.doComplete(sources).then(([startcol, items]) => {
                if (items.length == 0) {
                    // no items found
                    completes_1.default.reset();
                    return;
                }
                nvim.setVar('coc#_context', {
                    start: startcol,
                    candidates: items
                }).catch(this.handleError);
                nvim.call('coc#_do_complete', []).then(() => {
                    logger.debug(`Complete time cost: ${Date.now() - start}ms`);
                }).catch(this.handleError);
                this.onCompleteStart(opt).catch(this.handleError);
            }, this.handleError);
        });
    }
    onCompleteStart(opt) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { linenr, input } = opt;
            let { nvim, increment } = this;
            yield index_1.wait(50);
            let visible = yield nvim.call('pumvisible');
            let [_, lnum, col] = yield nvim.call('getpos', ['.']);
            if (visible != 1 || lnum != linenr)
                return;
            let line = yield nvim.call('getline', ['.']);
            let word = col > opt.col ? line.slice(opt.col, col - 1) : '';
            // let's start
            increment.changedI = {
                linenr: lnum,
                colnr: col
            };
            increment.setOption(opt);
            yield increment.start(input, word);
        });
    }
    cocCharInsert() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.increment.onCharInsert();
        });
    }
    cocCompleteDone() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.increment.onCompleteDone();
        });
    }
    cocInsertLeave() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.increment.stop();
        });
    }
    cocTextChangeI() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { complete } = completes_1.default;
            let { nvim, increment } = this;
            if (!complete)
                return;
            let shouldStart = yield increment.onTextChangeI();
            if (shouldStart) {
                if (!increment.activted)
                    return;
                let { input, option } = increment;
                let opt = Object.assign({}, option, {
                    input: input.input
                });
                let oldComplete = completes_1.default.complete || {};
                let { results } = oldComplete;
                if (!results || results.length == 0) {
                    yield increment.stop();
                    return;
                }
                let start = Date.now();
                logger.debug(`Resume options: ${JSON.stringify(opt)}`);
                let { startcol, icase } = oldComplete;
                let complete = completes_1.default.newComplete(opt);
                let items = complete.filterResults(results, icase);
                logger.debug(`Filtered items:${JSON.stringify(items)}`);
                if (!items || items.length === 0) {
                    yield increment.stop();
                    return;
                }
                nvim.setVar('coc#_context', {
                    start: startcol,
                    candidates: items
                }).catch(this.handleError);
                nvim.call('coc#_do_complete', []).then(() => {
                    logger.debug(`Complete time cost: ${Date.now() - start}ms`);
                }).catch(this.handleError);
            }
        });
    }
    // callback for remote sources
    cocResult(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let id = Number(args[0]);
            let name = args[1];
            let items = args[2];
            items = items || [];
            logger.debug(`Remote ${name} result count: ${items.length}`);
            remote_store_1.default.setResult(id, name, items);
        });
    }
    // Used for :checkhealth
    cocCheck() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            yield remotes_1.default.init(nvim, natives_1.default.names, true);
            let { names } = remotes_1.default;
            let success = true;
            for (let name of names) {
                let source = remotes_1.default.createSource(nvim, name, true);
                if (source == null) {
                    success = false;
                }
            }
            return success ? names : null;
        });
    }
    cocSourceStat() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let disabled = config_1.getConfig('disabled');
            let res = [];
            let items = natives_1.default.list.concat(remotes_1.default.list);
            for (let item of items) {
                let { name, filepath } = item;
                res.push({
                    name,
                    type: natives_1.default.has(name) ? 'native' : 'remote',
                    disabled: disabled.indexOf(name) !== -1,
                    filepath
                });
            }
            return res;
        });
    }
    cocSourceToggle(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let name = args[0].toString();
            if (!name)
                return '';
            if (!natives_1.default.has(name) && !remotes_1.default.has(name)) {
                yield index_1.echoErr(this.nvim, `Source ${name} not found`);
                return '';
            }
            return config_1.toggleSource(name);
        });
    }
    cocSourceRefresh(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let name = args[0].toString();
            if (name) {
                let m = natives_1.default.has(name) ? natives_1.default : remotes_1.default;
                let source = yield m.getSource(this.nvim, name);
                if (!source) {
                    yield index_1.echoErr(this.nvim, `Source ${name} not found`);
                    return false;
                }
                yield source.refresh();
            }
            else {
                for (let m of [remotes_1.default, natives_1.default]) {
                    for (let s of m.sources) {
                        if (s) {
                            yield s.refresh();
                        }
                    }
                }
            }
            return true;
        });
    }
    onBufferChange(bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let listed = yield this.nvim.call('getbufvar', [Number(bufnr), '&buflisted']);
            if (listed)
                yield buffers_1.default.addBuffer(this.nvim, bufnr);
        });
    }
    initConfig() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let opts = yield nvim.call('coc#get_config', []);
            config_1.setConfig(opts);
        });
    }
};
tslib_1.__decorate([
    neovim_1.Function('CocInitAsync', { sync: false })
], CompletePlugin.prototype, "cocInitAsync", null);
tslib_1.__decorate([
    neovim_1.Function('CocInitSync', { sync: true })
], CompletePlugin.prototype, "cocInitSync", null);
tslib_1.__decorate([
    neovim_1.Function('CocBufUnload', { sync: false })
], CompletePlugin.prototype, "cocBufUnload", null);
tslib_1.__decorate([
    neovim_1.Function('CocBufChange', { sync: false })
], CompletePlugin.prototype, "cocBufChange", null);
tslib_1.__decorate([
    neovim_1.Function('CocStart', { sync: false })
], CompletePlugin.prototype, "cocStart", null);
tslib_1.__decorate([
    neovim_1.Autocmd('InsertCharPre', {
        pattern: '*',
        sync: true,
    })
], CompletePlugin.prototype, "cocCharInsert", null);
tslib_1.__decorate([
    neovim_1.Autocmd('CompleteDone', {
        pattern: '*',
        sync: true,
    })
], CompletePlugin.prototype, "cocCompleteDone", null);
tslib_1.__decorate([
    neovim_1.Autocmd('InsertLeave', {
        pattern: '*',
        sync: true,
    })
], CompletePlugin.prototype, "cocInsertLeave", null);
tslib_1.__decorate([
    neovim_1.Autocmd('TextChangedI', {
        pattern: '*',
        sync: true
    })
], CompletePlugin.prototype, "cocTextChangeI", null);
tslib_1.__decorate([
    neovim_1.Function('CocResult', { sync: false })
], CompletePlugin.prototype, "cocResult", null);
tslib_1.__decorate([
    neovim_1.Function('CocCheck', { sync: true })
], CompletePlugin.prototype, "cocCheck", null);
tslib_1.__decorate([
    neovim_1.Function('CocSourceStat', { sync: true })
], CompletePlugin.prototype, "cocSourceStat", null);
tslib_1.__decorate([
    neovim_1.Function('CocSourceToggle', { sync: true })
], CompletePlugin.prototype, "cocSourceToggle", null);
tslib_1.__decorate([
    neovim_1.Function('CocSourceRefresh', { sync: true })
], CompletePlugin.prototype, "cocSourceRefresh", null);
CompletePlugin = tslib_1.__decorate([
    neovim_1.Plugin({ dev: false })
], CompletePlugin);
exports.default = CompletePlugin;
//# sourceMappingURL=index.js.map