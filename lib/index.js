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
const constant_1 = require("./constant");
const service_1 = require("./source/service");
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
        this.handleError = this.handleError.bind(this);
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
                    yield buffers_1.default.addBuffer(nvim, buf);
                }
                let filetypes = yield nvim.call('coc#util#get_filetypes', []);
                for (let filetype of filetypes) {
                    yield this.onFileType(filetype);
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
            let bufnr = Number(args[0]);
            buffers_1.default.removeBuffer(bufnr);
            logger.debug(`buffer ${bufnr} remove`);
        });
    }
    cocBufChange(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.debouncedOnChange(Number(args[0]));
        });
    }
    cocStart(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let opt = args[0];
            let start = Date.now();
            let { nvim, increment } = this;
            // may happen
            yield increment.stop();
            logger.debug(`options: ${JSON.stringify(opt)}`);
            let { filetype, linecount } = opt;
            if (linecount > constant_1.MAX_CODE_LINES) {
                yield index_1.echoWarning(nvim, `Buffer line count exceeded ${constant_1.MAX_CODE_LINES}, completion stopped`);
                return;
            }
            yield buffers_1.default.createDocument(nvim, opt);
            let complete = completes_1.default.createComplete(opt);
            let sources = yield completes_1.default.getSources(nvim, filetype);
            complete.doComplete(sources).then(([startcol, items]) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                if (items.length == 0) {
                    // no items found
                    completes_1.default.reset();
                    return;
                }
                let autoComplete = items.length == 1 && config_1.shouldAutoComplete();
                if (!autoComplete) {
                    yield increment.start(opt);
                }
                yield nvim.setVar('coc#_context', {
                    start: startcol,
                    candidates: items
                });
                yield nvim.call('coc#_do_complete', []);
                logger.debug(`Complete time cost: ${Date.now() - start}ms`);
                completes_1.default.calculateChars(items);
                this.onCompleteStart(opt, autoComplete, items).catch(this.handleError);
            }), this.handleError);
        });
    }
    cocInsertCharPre(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.increment.onCharInsert(args[0]);
        });
    }
    cocInsertLeave() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.increment.stop();
        });
    }
    cocCompleteDone(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            logger.debug('complete done');
            let { nvim, increment } = this;
            let item = args[0];
            // vim would send {} on cancel
            if (!item || Object.keys(item).length == 0)
                item = null;
            let isCoc = index_1.isCocItem(item);
            logger.debug(`complete item:${JSON.stringify(item)}`);
            yield increment.onCompleteDone(item);
            if (isCoc) {
                completes_1.default.addRecent(item.word);
                if (item.user_data) {
                    let data = JSON.parse(item.user_data);
                    let source = yield completes_1.default.getSource(nvim, data.source);
                    if (source) {
                        yield source.onCompleteDone(item);
                    }
                }
            }
        });
    }
    cocTextChangedP() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            logger.debug('TextChangedP');
            let { latestTextChangedI } = this.increment;
            if (!latestTextChangedI) {
                yield this.increment.stop();
                // navigation change
            }
        });
    }
    cocTextChangedI() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { complete } = completes_1.default;
            let { nvim, increment } = this;
            if (!complete)
                return;
            let shouldStart = yield increment.onTextChangedI();
            if (shouldStart) {
                let { input, option } = increment;
                let opt = Object.assign({}, option, {
                    input: input.search
                });
                let oldComplete = completes_1.default.complete || {};
                let { results } = oldComplete;
                if (!results || results.length == 0) {
                    yield increment.stop();
                    return;
                }
                let start = Date.now();
                logger.debug(`Resume options: ${JSON.stringify(opt)}`);
                let { startcol } = oldComplete;
                let complete = completes_1.default.newComplete(opt);
                let items = complete.filterResults(results);
                logger.debug(`Filtered items:${JSON.stringify(items)}`);
                if (!items || items.length === 0) {
                    yield increment.stop();
                    return;
                }
                let autoComplete = items.length == 1 && config_1.shouldAutoComplete();
                if (autoComplete) {
                    // let vim complete it
                    yield increment.stop();
                }
                yield nvim.setVar('coc#_context', {
                    start: startcol,
                    candidates: items
                });
                yield nvim.call('coc#_do_complete', []);
                logger.debug(`Complete time cost: ${Date.now() - start}ms`);
                this.onCompleteStart(opt, autoComplete, items).catch(this.handleError);
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
    cocCheckHealth() {
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
    cocFileTypeChange(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let filetype = args[0];
            yield this.onFileType(filetype);
        });
    }
    cocShowSignature(args) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.callServiceFunc('showSignature');
        });
    }
    cocShowType() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.callServiceFunc('showDefinition');
        });
    }
    cocShowDoc() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.callServiceFunc('showDocuments');
        });
    }
    cocJumpDefninition() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            yield this.callServiceFunc('jumpDefinition');
        });
    }
    callServiceFunc(func) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let opt = yield nvim.call('coc#util#get_queryoption');
            let { filetype } = opt;
            let source = yield natives_1.default.getServiceSource(nvim, filetype);
            if (source) {
                yield source[func](opt);
            }
        });
    }
    // init service on filetype change
    onFileType(filetype) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!filetype || service_1.supportedTypes.indexOf(filetype) === -1)
                return;
            let names = service_1.serviceMap[filetype];
            let disabled = config_1.getConfig('disabled');
            for (let name of names) {
                if (disabled.indexOf(name) === -1) {
                    let source = yield natives_1.default.getServiceSource(this.nvim, filetype);
                    if (source)
                        yield source.bindEvents();
                }
            }
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
    onCompleteStart(opt, autoComplete, items) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            yield index_1.wait(20);
            let visible = yield nvim.call('pumvisible');
            if (!autoComplete && !visible) {
                // TODO find out the way to trigger completeDone
                // if no way to trigger completeDone,
                // handle it here
            }
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
    neovim_1.Function('CocInsertCharPre', { sync: true })
], CompletePlugin.prototype, "cocInsertCharPre", null);
tslib_1.__decorate([
    neovim_1.Function('CocInsertLeave', { sync: false })
], CompletePlugin.prototype, "cocInsertLeave", null);
tslib_1.__decorate([
    neovim_1.Function('CocCompleteDone', { sync: true })
], CompletePlugin.prototype, "cocCompleteDone", null);
tslib_1.__decorate([
    neovim_1.Function('CocTextChangedP', { sync: true })
], CompletePlugin.prototype, "cocTextChangedP", null);
tslib_1.__decorate([
    neovim_1.Function('CocTextChangedI', { sync: true })
], CompletePlugin.prototype, "cocTextChangedI", null);
tslib_1.__decorate([
    neovim_1.Function('CocResult', { sync: false })
], CompletePlugin.prototype, "cocResult", null);
tslib_1.__decorate([
    neovim_1.Function('CocCheckHealth', { sync: true })
], CompletePlugin.prototype, "cocCheckHealth", null);
tslib_1.__decorate([
    neovim_1.Function('CocSourceStat', { sync: true })
], CompletePlugin.prototype, "cocSourceStat", null);
tslib_1.__decorate([
    neovim_1.Function('CocSourceToggle', { sync: true })
], CompletePlugin.prototype, "cocSourceToggle", null);
tslib_1.__decorate([
    neovim_1.Function('CocSourceRefresh', { sync: true })
], CompletePlugin.prototype, "cocSourceRefresh", null);
tslib_1.__decorate([
    neovim_1.Function('CocFileTypeChange', { sync: false })
], CompletePlugin.prototype, "cocFileTypeChange", null);
tslib_1.__decorate([
    neovim_1.Function('CocShowSignature', { sync: false })
], CompletePlugin.prototype, "cocShowSignature", null);
tslib_1.__decorate([
    neovim_1.Function('CocShowDefinition', { sync: false })
], CompletePlugin.prototype, "cocShowType", null);
tslib_1.__decorate([
    neovim_1.Command('CocShowDoc', { sync: false, nargs: '*' })
], CompletePlugin.prototype, "cocShowDoc", null);
tslib_1.__decorate([
    neovim_1.Function('CocJumpDefinition', { sync: true })
], CompletePlugin.prototype, "cocJumpDefninition", null);
CompletePlugin = tslib_1.__decorate([
    neovim_1.Plugin({ dev: false })
], CompletePlugin);
exports.default = CompletePlugin;
//# sourceMappingURL=index.js.map