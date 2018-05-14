"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("./config");
const input_1 = require("./input");
const buffers_1 = require("./buffers");
const completes_1 = require("./completes");
const logger = require('./util/logger')('increment');
const MAX_DURATION = 50;
class Increment {
    constructor(nvim) {
        this.activted = false;
        this.nvim = nvim;
    }
    isKeyword(str) {
        let { document } = buffers_1.default;
        return document ? document.isWord(str) : /^\w$/.test(str);
    }
    stop() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.activted)
                return;
            this.activted = false;
            if (this.input)
                yield this.input.clear();
            this.done = this.input = this.option = this.changedI = null;
            let completeOpt = config_1.getConfig('completeOpt');
            completes_1.default.reset();
            yield this.nvim.call('execute', [`noa set completeopt=${completeOpt}`]);
            logger.debug('increment stoped');
        });
    }
    /**
     * start
     *
     * @public
     * @param {string} input - current user input
     * @param {string} word - the word before cursor
     * @returns {Promise<void>}
     */
    start(input, word) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim, activted, option } = this;
            if (activted || !option)
                return;
            let { linenr, col } = option;
            // clear beginning input
            if (this.input) {
                yield this.input.clear();
                this.input = null;
            }
            let inputTarget = new input_1.default(nvim, input, word, linenr, col);
            if (inputTarget.isValid) {
                this.activted = true;
                this.input = inputTarget;
                yield inputTarget.highlight();
                let opt = this.getNoinsertOption();
                yield nvim.call('execute', [`noa set completeopt=${opt}`]);
                logger.debug('increment started');
            }
        });
    }
    setOption(opt) {
        this.option = opt;
    }
    isCompleteItem(item) {
        if (!item)
            return false;
        let { user_data } = item;
        if (!user_data)
            return false;
        try {
            let res = JSON.parse(user_data);
            return res.cid != null;
        }
        catch (e) {
            return false;
        }
    }
    onCompleteDone() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { option, nvim } = this;
            if (!option)
                return null;
            let [_, lnum, colnr] = yield nvim.call('getcurpos', []);
            let changedtick = yield nvim.eval('b:changedtick');
            let item = yield nvim.getVvar('completed_item');
            if (Object.keys(item).length && !this.isCompleteItem(item)) {
                yield this.stop();
                return null;
            }
            if (this.input && !this.activted) {
                this.input.clear();
                this.input = null;
            }
            this.done = {
                word: item ? item.word || '' : '',
                timestamp: Date.now(),
                colnr: Number(colnr),
                linenr: Number(lnum),
                changedtick: Number(changedtick)
            };
            logger.debug(JSON.stringify(this.done));
        });
    }
    onCharInsert() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let ch = yield this.nvim.getVvar('char');
            this.lastInsert = {
                character: ch,
                timestamp: Date.now()
            };
            let { activted, input } = this;
            if (!activted)
                return;
            let isKeyword = this.isKeyword(ch);
            if (!isKeyword)
                return yield this.stop();
            let visible = yield this.nvim.call('pumvisible');
            if (visible != 1)
                return yield this.stop();
            // vim would attamp to match the string
            // if vim find match, no TextChangeI would fire
            // we should disable this behavior by
            // hide the popup
            yield this.nvim.call('coc#_hide');
        });
    }
    getNoinsertOption() {
        let opt = config_1.getConfig('completeOpt');
        let parts = opt.split(',');
        parts.filter(s => s != 'menu');
        if (parts.indexOf('menu') === -1
            && parts.indexOf('menuone') === -1) {
            parts.push('menuone');
        }
        if (parts.indexOf('noinsert') === -1) {
            parts.push('noinsert');
        }
        return parts.join(',');
    }
    onTextChangeI() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { option, activted, done, lastInsert, nvim } = this;
            if (!option)
                return false;
            let [_, linenr, colnr] = yield nvim.call('getcurpos', []);
            let bufnr = yield nvim.call('bufnr', ['%']);
            if (bufnr.toString() != option.bufnr || linenr != option.linenr) {
                yield this.stop();
                return false;
            }
            let changedtick = yield nvim.eval('b:changedtick');
            let lastChanged = Object.assign({}, this.changedI);
            this.changedI = {
                linenr,
                colnr
            };
            let ts = Date.now();
            if (!activted) {
                // check start
                let { input, col, linenr } = option;
                if (done && ts - done.timestamp < MAX_DURATION) {
                    let { word } = done;
                    if (changedtick - done.changedtick !== 1)
                        return false;
                    // if (done.word && !this.isKeyword(done.word)) return false
                    if (lastInsert && ts - lastInsert.timestamp < MAX_DURATION) {
                        let ch = lastInsert.character;
                        yield this.start(input + ch, word + ch);
                        return true;
                    }
                    if (done.colnr - colnr === 1
                        && word
                        && input.length > 0) {
                        yield this.start(input.slice(0, -1), done.word.slice(0, -1));
                        return true;
                    }
                }
            }
            if (activted) {
                // check continue
                if (lastInsert
                    && this.input
                    && ts - lastInsert.timestamp < MAX_DURATION
                    && colnr - lastChanged.colnr === 1) {
                    yield this.input.addCharactor(lastInsert.character);
                    return true;
                }
                if (lastChanged.colnr - colnr === 1
                    && this.input
                    && ts - done.timestamp < MAX_DURATION) {
                    let invalid = yield this.input.removeCharactor();
                    if (!invalid)
                        return true;
                }
                logger.debug(777);
                yield this.stop();
                return false;
            }
            return false;
        });
    }
}
exports.default = Increment;
//# sourceMappingURL=increment.js.map