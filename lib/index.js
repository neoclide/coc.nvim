"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
const neovim_1 = require("neovim");
const logger_1 = require("./util/logger");
const config_1 = require("./config");
const debounce = require("debounce");
const buffers_1 = require("./buffers");
const completes_1 = require("./completes");
const remote_store_1 = require("./remote-store");
const remotes_1 = require("./remotes");
let CompletePlugin = class CompletePlugin {
    constructor(nvim) {
        this.nvim = nvim;
        this.debouncedOnChange = debounce((bufnr) => {
            this.onBufferChange(bufnr);
            logger_1.logger.debug(`buffer ${bufnr} change`);
        }, 800);
        process.on('unhandledRejection', (reason, p) => {
            logger_1.logger.error('Unhandled Rejection at:', p, 'reason:', reason);
            if (reason instanceof Error) {
                nvim.call('complete#util#print_errors', [reason.stack.split(/\n/)]).catch(err => {
                    logger_1.logger.error(err.message);
                });
            }
        });
    }
    onVimEnter() {
        return __awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            yield this.initConfig();
            yield remotes_1.default.init(nvim);
        });
    }
    onBufferWrite(buf) {
        return __awaiter(this, void 0, void 0, function* () {
            let buftype = yield this.nvim.call('getbufvar', [Number(buf), '&buftype']);
            if (!buftype) {
                this.onBufferChange(buf);
            }
        });
    }
    onBufUnload(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            buffers_1.default.removeBuffer(bufnr);
            logger_1.logger.debug(`buffer ${bufnr} remove`);
        });
    }
    onBufAdd(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            logger_1.logger.debug(`buffer ${bufnr} read`);
            this.onBufferChange(bufnr);
        });
    }
    onBufChangeI(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let bufnr = args[0].toString();
            let curr = yield this.nvim.call('bufnr', ['%']);
            if (curr.toString() == bufnr) {
                this.debouncedOnChange(bufnr);
            }
            else {
                logger_1.logger.debug(`buffer ${bufnr} change`);
                this.onBufferChange(bufnr);
            }
        });
    }
    completeStart(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let opt = args[0];
            let start = Date.now();
            if (opt) {
                logger_1.logger.debug(`options: ${JSON.stringify(opt)}`);
                let { filetype, col } = opt;
                let complete = completes_1.default.createComplete(opt);
                let sources = yield completes_1.default.getSources(this.nvim, filetype);
                complete.doComplete(sources).then(items => {
                    if (items === null)
                        items = [];
                    logger_1.logger.debug(`items: ${JSON.stringify(items, null, 2)}`);
                    if (items.length > 0) {
                        this.nvim.setVar('complete#_context', {
                            start: col,
                            candidates: items
                        });
                        this.nvim.call('complete#_do_complete', []).then(() => {
                            logger_1.logger.debug(`Complete time cost: ${Date.now() - start}ms`);
                        });
                    }
                });
                return null;
            }
        });
    }
    completeResult(args) {
        return __awaiter(this, void 0, void 0, function* () {
            let id = args[0];
            let name = args[1];
            let items = args[2];
            remote_store_1.default.setResult(id, name, items);
        });
    }
    onBufferChange(bufnr) {
        this.nvim.call('getbufline', [Number(bufnr), 1, '$']).then(lines => {
            let content = lines.join('\n');
            buffers_1.default.addBuffer(bufnr, content);
        }, e => {
            logger_1.logger.error(e.message);
        });
    }
    initConfig() {
        return __awaiter(this, void 0, void 0, function* () {
            let { nvim } = this;
            let opts = yield nvim.call('complete#get_config', []);
            config_1.setConfig(opts);
        });
    }
};
__decorate([
    neovim_1.Autocmd('VimEnter', {
        sync: false,
        pattern: '*'
    })
], CompletePlugin.prototype, "onVimEnter", null);
__decorate([
    neovim_1.Autocmd('BufWritePost', {
        sync: false,
        pattern: '*',
        eval: 'expand("<abuf>")',
    })
], CompletePlugin.prototype, "onBufferWrite", null);
__decorate([
    neovim_1.Function('CompleteBufUnload', { sync: false })
], CompletePlugin.prototype, "onBufUnload", null);
__decorate([
    neovim_1.Function('CompleteBufRead', { sync: false })
], CompletePlugin.prototype, "onBufAdd", null);
__decorate([
    neovim_1.Function('CompleteBufChange', { sync: false })
], CompletePlugin.prototype, "onBufChangeI", null);
__decorate([
    neovim_1.Function('CompleteStart', { sync: false })
], CompletePlugin.prototype, "completeStart", null);
__decorate([
    neovim_1.Function('CompleteResult', { sync: false })
], CompletePlugin.prototype, "completeResult", null);
CompletePlugin = __decorate([
    neovim_1.Plugin({ dev: false })
], CompletePlugin);
exports.default = CompletePlugin;
//# sourceMappingURL=index.js.map