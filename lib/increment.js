"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("./config");
const input_1 = require("./model/input");
const completes_1 = require("./completes");
const logger = require('./util/logger')('increment');
const MAX_DURATION = 200;
class Increment {
    constructor(nvim) {
        this.activted = false;
        this.nvim = nvim;
    }
    stop() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.activted)
                return;
            this.activted = false;
            if (this.input)
                yield this.input.clear();
            this.done = this.input = this.changedI = null;
            let completeOpt = config_1.getConfig('completeOpt');
            completes_1.default.reset();
            yield this.nvim.call('execute', [`noa set completeopt=${completeOpt}`]);
            logger.debug('increment stopped');
        });
    }
    get latestDone() {
        let { done } = this;
        if (!done || Date.now() - done.timestamp > MAX_DURATION)
            return null;
        return done;
    }
    get latestTextChangedI() {
        let { changedI } = this;
        if (!changedI || Date.now() - changedI.timestamp > MAX_DURATION)
            return null;
        return changedI;
    }
    /**
     * start
     *
     * @public
     * @param {string} input - current user input
     * @param {string} word - the word before cursor
     * @returns {Promise<void>}
     */
    start(option) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { nvim, activted } = this;
            if (activted)
                return;
            let { linenr, colnr, input, col } = option;
            this.changedI = { linenr, colnr, timestamp: Date.now() };
            let inputTarget = new input_1.default(nvim, input, linenr, col);
            this.activted = true;
            this.input = inputTarget;
            yield inputTarget.highlight();
            let opt = this.getStartOption();
            yield nvim.call('execute', [`noa set completeopt=${opt}`]);
            logger.debug('increment started');
        });
    }
    onCompleteDone(item) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.activted)
                return;
            let { nvim } = this;
            let [_, lnum, colnr] = yield nvim.call('getcurpos', []);
            if (item) {
                logger.debug('complete done with item, increment stopped');
                yield this.stop();
            }
            this.done = {
                word: item ? item.word || '' : '',
                timestamp: Date.now(),
                colnr,
                linenr: lnum,
            };
        });
    }
    onCharInsert(ch) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            if (!this.activted)
                return;
            this.lastInsert = {
                character: ch,
                timestamp: Date.now()
            };
            if (!completes_1.default.hasCharacter(ch)) {
                logger.debug(`character ${ch} not found`);
                yield this.stop();
                return;
            }
            // vim would attamp to match the string
            // if vim find match, no TextChangeI would fire
            // we have to disable this behavior by
            // send <C-e> to hide the popup
            yield this.nvim.call('coc#_hide');
        });
    }
    // keep other options
    getStartOption() {
        let opt = config_1.getConfig('completeOpt');
        let useNoSelect = config_1.getConfig('noSelect');
        let parts = opt.split(',');
        // longest & menu can't work with increment search
        parts.filter(s => s != 'menu' && s != 'longest');
        if (parts.indexOf('menuone') === -1) {
            parts.push('menuone');
        }
        if (parts.indexOf('noinsert') === -1) {
            parts.push('noinsert');
        }
        if (useNoSelect && parts.indexOf('noselect') === -1) {
            parts.push('noselect');
        }
        return parts.join(',');
    }
    onTextChangedI() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { activted, lastInsert, nvim } = this;
            if (!activted)
                return false;
            let [_, linenr, colnr] = yield nvim.call('getcurpos', []);
            let { option } = completes_1.default;
            if (!option || linenr != option.linenr) {
                yield this.stop();
                return false;
            }
            logger.debug('text changedI');
            let lastChanged = Object.assign({}, this.changedI);
            this.changedI = { linenr, colnr, timestamp: Date.now() };
            // check continue
            if (lastInsert && colnr - lastChanged.colnr === 1) {
                yield this.input.addCharactor(lastInsert.character);
                return true;
            }
            if (lastChanged.colnr - colnr === 1) {
                let invalid = yield this.input.removeCharactor();
                if (!invalid)
                    return true;
            }
            logger.debug('increment failed');
            yield this.stop();
            return false;
        });
    }
}
exports.default = Increment;
//# sourceMappingURL=increment.js.map