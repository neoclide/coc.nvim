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
const fundebug = require("fundebug-nodejs");
const remote_store_1 = require("./remote-store");
const increment_1 = require("./increment");
const logger = require('./util/logger')('index');
fundebug.apikey = '08fef3f3304dc6d9acdb5568e4bf65edda6bf3ce41041d40c60404f16f72b86e';
let CompletePlugin = class CompletePlugin {
    constructor(nvim) {
        this.nvim = nvim;
        this.debouncedOnChange = index_1.contextDebounce((bufnr) => {
            this.onBufferChange(bufnr).catch(e => {
                logger.error(e.message);
            });
            logger.debug(`buffer ${bufnr} change`);
        }, 500);
        process.on('unhandledRejection', (reason, p) => {
            logger.error('Unhandled Rejection at:', p, 'reason:', reason);
            if (reason instanceof Error)
                this.handleError(reason);
        });
        process.on('uncaughtException', this.handleError);
    }
    handleError(err) {
        let { nvim } = this;
        index_1.echoErr(nvim, `Service error: ${err.message}`).catch(err => {
            logger.error(err.message);
        });
        if (config_1.getConfig('traceError') && process.env.NODE_ENV !== 'test') {
            // fundebug.notifyError(err)
        }
    }
    onVimEnter() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            try {
                yield this.initConfig();
                yield natives_1.default.init();
                yield remotes_1.default.init(nvim, natives_1.default.names);
                yield nvim.command(`let g:complete_node_channel_id=${nvim._channel_id}`);
                yield nvim.command('silent doautocmd User CompleteNvimInit');
                logger.info('Complete service Initailized');
                // required since BufRead triggered before VimEnter
                let bufs = yield nvim.call('complete#util#get_buflist', []);
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
    onBufUnload(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            buffers_1.default.removeBuffer(bufnr);
            logger.debug(`buffer ${bufnr} remove`);
        });
    }
    onBufChange(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            this.debouncedOnChange(bufnr);
        });
    }
    completeStart(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let opt = args[0];
            let start = Date.now();
            if (!opt)
                return;
            logger.debug(`options: ${JSON.stringify(opt)}`);
            let { filetype, col } = opt;
            let complete = completes_1.default.createComplete(opt);
            let sources = yield completes_1.default.getSources(this.nvim, filetype);
            complete.doComplete(sources).then(([startcol, items]) => {
                if (items.length == 0) {
                    // no items found
                    completes_1.default.reset();
                    return;
                }
                completes_1.default.firstItem = items[0];
                if (items.length > 1) {
                    increment_1.default.setOption(opt);
                }
                this.nvim.setVar('complete#_context', {
                    start: startcol,
                    candidates: items
                });
                this.nvim.call('complete#_do_complete', []).then(() => {
                    logger.debug(`Complete time cost: ${Date.now() - start}ms`);
                });
            });
        });
    }
    completeCharInsert() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield increment_1.default.onCharInsert(this.nvim);
        });
    }
    completeDone() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield increment_1.default.onComplete(this.nvim);
        });
    }
    completeLeave() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield increment_1.default.stop(this.nvim);
        });
    }
    completeTextChangeI() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { complete } = completes_1.default;
            if (!complete)
                return;
            let shouldStart = yield increment_1.default.onTextChangeI(this.nvim);
            if (shouldStart) {
                yield this.completeResume();
            }
        });
    }
    completeResume() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!increment_1.default.activted)
                return;
            let { input, option, changedI } = increment_1.default;
            let opt = Object.assign({}, option, {
                changedtick: changedI.changedtick,
                input: input.input
            });
            let oldComplete = completes_1.default.complete || {};
            let { results } = oldComplete;
            if (!results || results.length == 0) {
                yield increment_1.default.stop(this.nvim);
                return;
            }
            let start = Date.now();
            logger.debug(`Resume options: ${JSON.stringify(opt)}`);
            let { startcol, icase } = oldComplete;
            let complete = completes_1.default.newComplete(opt);
            let items = complete.filterResults(results, icase);
            logger.debug(`Filtered items:${JSON.stringify(items)}`);
            if (!items || items.length === 0) {
                yield increment_1.default.stop(this.nvim);
                return;
            }
            this.nvim.setVar('complete#_context', {
                start: startcol,
                candidates: items
            });
            this.nvim.call('complete#_do_complete', []).then(() => {
                logger.debug(`Complete time cost: ${Date.now() - start}ms`);
            });
        });
    }
    completeResult(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let id = Number(args[0]);
            let name = args[1];
            let items = args[2];
            items = items || [];
            remote_store_1.default.setResult(id, name, items);
        });
    }
    completeCheck() {
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
    completeSourceStat() {
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
    completeSourceConfig(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let name = args[0];
            let config = args[1];
            if (!name)
                return;
            config_1.configSource(name, config);
        });
    }
    completeSourceToggle(args) {
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
    completeSourceRefresh(args) {
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
            let opts = yield nvim.call('complete#get_config', []);
            config_1.setConfig(opts);
        });
    }
};
tslib_1.__decorate([
    neovim_1.Autocmd('VimEnter', {
        sync: false,
        pattern: '*'
    })
], CompletePlugin.prototype, "onVimEnter", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteBufUnload', { sync: false })
], CompletePlugin.prototype, "onBufUnload", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteBufChange', { sync: false })
], CompletePlugin.prototype, "onBufChange", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteStart', { sync: false })
], CompletePlugin.prototype, "completeStart", null);
tslib_1.__decorate([
    neovim_1.Autocmd('InsertCharPre', {
        pattern: '*',
        sync: true,
    })
], CompletePlugin.prototype, "completeCharInsert", null);
tslib_1.__decorate([
    neovim_1.Autocmd('CompleteDone', {
        pattern: '*',
        sync: true,
    })
], CompletePlugin.prototype, "completeDone", null);
tslib_1.__decorate([
    neovim_1.Autocmd('InsertLeave', {
        pattern: '*',
        sync: true,
    })
], CompletePlugin.prototype, "completeLeave", null);
tslib_1.__decorate([
    neovim_1.Autocmd('TextChangedI', {
        pattern: '*',
        sync: true
    })
], CompletePlugin.prototype, "completeTextChangeI", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteResult', { sync: false })
], CompletePlugin.prototype, "completeResult", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteCheck', { sync: true })
], CompletePlugin.prototype, "completeCheck", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteSourceStat', { sync: true })
], CompletePlugin.prototype, "completeSourceStat", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteSourceConfig', { sync: false })
], CompletePlugin.prototype, "completeSourceConfig", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteSourceToggle', { sync: true })
], CompletePlugin.prototype, "completeSourceToggle", null);
tslib_1.__decorate([
    neovim_1.Function('CompleteSourceRefresh', { sync: true })
], CompletePlugin.prototype, "completeSourceRefresh", null);
CompletePlugin = tslib_1.__decorate([
    neovim_1.Plugin({ dev: true })
], CompletePlugin);
exports.default = CompletePlugin;
//# sourceMappingURL=index.js.map