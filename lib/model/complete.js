"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = require("../util/logger");
const buffers_1 = require("../buffers");
class Complete {
    constructor(opts) {
        let { bufnr, line, col, input, filetype, word } = opts;
        let buf = buffers_1.default.getBuffer(bufnr.toString());
        if (!buf) {
            this.id = '';
        }
        else {
            this.id = `${buf.hash}|${line}|${col}`;
        }
        this.word = word || '';
        this.bufnr = bufnr || '';
        this.line = line || 0;
        this.col = col || 0;
        this.input = input || '';
        this.filetype = filetype || '';
        this.result = null;
        this.callbacks = [];
        let self = this;
        let running = false;
        Object.defineProperty(this, 'running', {
            get() {
                return running;
            },
            set(newValue) {
                running = newValue;
                if (newValue === false && self.callbacks.length) {
                    let callback = self.callbacks.pop();
                    callback();
                    self.callbacks = [];
                }
            }
        });
    }
    getOption() {
        if (!this.id)
            return null;
        return {
            filetype: this.filetype,
            bufnr: this.bufnr,
            line: this.line,
            col: this.col,
            input: this.input,
            id: this.id,
            word: this.word,
        };
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
            }, 300);
        });
    }
    doComplete(sources) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.result)
                return this.result;
            if (this.running === true) {
                let p = new Promise(resolve => {
                    this.callbacks.push(() => {
                        resolve();
                    });
                    setTimeout(() => {
                        resolve();
                    }, 1000);
                });
                yield p;
                return this.result;
            }
            this.running = true;
            let opts = this.getOption();
            if (opts === null)
                return [];
            sources.sort((a, b) => b.priority - a.priority);
            let { filetype, word, input } = this;
            let valids = [];
            logger_1.logger.debug('input:' + opts.input);
            logger_1.logger.debug('len:' + opts.input.length);
            for (let s of sources) {
                let shouldRun = yield s.shouldComplete(opts);
                logger_1.logger.debug('shouldRun:' + shouldRun);
                if (!shouldRun)
                    continue;
                let { filetypes } = s;
                if (filetypes.length && filetypes.indexOf(filetype) == -1)
                    continue;
                valids.push(s);
            }
            if (valids.length == 0) {
                logger_1.logger.debug('No source to complete');
                return [];
            }
            let source = valids.find(s => s.engross === true);
            if (source)
                valids = [source];
            let result = yield Promise.all(valids.map(s => this.completeSource(s, opts)));
            let arr = [];
            for (let res of result) {
                if (res == null)
                    continue;
                let { items, offsetLeft, offsetRight } = res;
                let hasOffset = !!offsetLeft || !!offsetRight;
                let user_data = hasOffset ? JSON.stringify({
                    offsetLeft: offsetLeft || 0,
                    offsetRight: offsetRight || 0
                }) : null;
                for (let item of items) {
                    // filter unnecessary results
                    if (item.word == word || item.word == input)
                        continue;
                    if (user_data) {
                        item.user_data = user_data;
                    }
                    arr.push(item);
                }
            }
            this.result = arr;
            this.running = false;
            return arr;
        });
    }
}
exports.default = Complete;
//# sourceMappingURL=complete.js.map