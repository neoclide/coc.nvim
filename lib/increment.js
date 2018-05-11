"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("./config");
const input_1 = require("./input");
const buffers_1 = require("./buffers");
const completes_1 = require("./completes");
const logger = require('./util/logger')('increment');
class Increment {
    constructor() {
        this.activted = false;
    }
    isKeyword(str) {
        let { document } = buffers_1.default;
        return document ? document.isWord(str) : /^\w$/.test(str);
    }
    stop(nvim) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.activted)
                return;
            logger.debug('increment stop');
            this.activted = false;
            if (this.input)
                yield this.input.clear();
            this.done = this.input = this.option = this.changedI = null;
            let completeOpt = config_1.getConfig('completeOpt');
            completes_1.default.reset();
            yield nvim.call('execute', [`noa set completeopt=${completeOpt}`]);
        });
    }
    start(nvim) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            this.activted = true;
            let completeOpt = yield nvim.getOption('completeopt');
            config_1.setConfig({ completeOpt });
            yield nvim.call('execute', [`noa set completeopt=menuone,noinsert`]);
        });
    }
    setOption(opt) {
        this.option = opt;
    }
    isCompleteItem(item) {
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
    onComplete(nvim) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { option } = this;
            if (!option)
                return;
            let [_, lnum, colnr] = yield nvim.call('getcurpos', []);
            let changedtick = yield nvim.eval('b:changedtick');
            let item = yield nvim.getVvar('completed_item');
            // if (!item || !item.word) return
            if (Object.keys(item).length && !this.isCompleteItem(item)) {
                yield this.stop(nvim);
                return;
            }
            this.done = {
                word: item.word || '',
                timestamp: Date.now(),
                colnr: Number(colnr),
                linenr: Number(lnum),
                changedtick: Number(changedtick)
            };
            logger.debug(JSON.stringify(this.done));
        });
    }
    onCharInsert(nvim) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let ch = yield nvim.getVvar('char');
            this.lastInsert = {
                character: ch,
                timestamp: Date.now()
            };
            let { activted, input } = this;
            if (activted && !this.isKeyword(ch)) {
                yield this.stop(nvim);
            }
        });
    }
    onTextChangeI(nvim) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { option, activted, done, lastInsert } = this;
            if (!option)
                return false;
            let [_, linenr, colnr] = yield nvim.call('getcurpos', []);
            let bufnr = yield nvim.call('bufnr', ['%']);
            if (bufnr.toString() != option.bufnr || linenr != option.linenr) {
                yield this.stop(nvim);
                return false;
            }
            let changedtick = yield nvim.eval('b:changedtick');
            changedtick = Number(changedtick);
            logger.debug(changedtick);
            let lastChanged = Object.assign({}, this.changedI);
            this.changedI = {
                linenr,
                colnr,
                changedtick
            };
            let ts = Date.now();
            if (!activted) {
                let { input, col, linenr } = option;
                if (done && ts - done.timestamp < 50) {
                    if (changedtick - done.changedtick !== 1)
                        return false;
                    if (done.word && !this.isKeyword(done.word))
                        return false;
                    if (lastInsert && ts - lastInsert.timestamp < 50) {
                        // user add one charactor on complete
                        this.input = new input_1.default(nvim, linenr, input, done.word, col);
                        yield this.input.addCharactor(lastInsert.character);
                        yield this.start(nvim);
                        return true;
                    }
                    if (done.colnr - colnr === 1) {
                        // user remove one charactor on complete
                        this.input = new input_1.default(nvim, linenr, input, done.word, col);
                        let invalid = yield this.input.removeCharactor();
                        if (!invalid) {
                            yield this.start(nvim);
                            return true;
                        }
                    }
                }
            }
            else {
                if (lastInsert && ts - lastInsert.timestamp < 50
                    && colnr - lastChanged.colnr === 1) {
                    yield this.input.addCharactor(lastInsert.character);
                    return true;
                }
                if (lastChanged.colnr - colnr === 1) {
                    let invalid = yield this.input.removeCharactor();
                    if (invalid) {
                        yield this.stop(nvim);
                        return false;
                    }
                    return true;
                }
                yield this.stop(nvim);
                return false;
            }
            return false;
        });
    }
}
exports.Increment = Increment;
exports.default = new Increment();
//# sourceMappingURL=increment.js.map