"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fuzzy_1 = require("../util/fuzzy");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('list-history');
class History {
    constructor(manager) {
        this.manager = manager;
        this.index = -1;
        this.loaded = [];
        this.current = [];
        this.db = workspace_1.default.createDatabase('history');
        let { prompt } = manager;
        prompt.onDidChangeInput(input => {
            if (input == this.curr)
                return;
            let codes = fuzzy_1.getCharCodes(input);
            this.current = this.loaded.filter(s => fuzzy_1.fuzzyMatch(codes, s));
            this.index = -1;
        });
    }
    get curr() {
        return this.index == -1 ? null : this.current[this.index];
    }
    // on list activted
    async load() {
        let { db } = this;
        let { input } = this.manager.prompt;
        let { name } = this.manager;
        let arr = await db.fetch(`${name}.${encodeURIComponent(workspace_1.default.cwd)}`);
        if (!arr || !Array.isArray(arr)) {
            this.loaded = [];
        }
        else {
            this.loaded = arr;
        }
        this.index = -1;
        this.current = this.loaded.filter(s => s.startsWith(input));
    }
    add() {
        let { loaded, db } = this;
        let { name, prompt } = this.manager;
        let { input } = prompt;
        if (!input || input.length < 2)
            return;
        let idx = loaded.indexOf(input);
        if (idx != -1)
            loaded.splice(idx, 1);
        loaded.push(input);
        if (loaded.length > 200) {
            loaded = loaded.slice(-200);
        }
        db.push(`${name}.${encodeURIComponent(workspace_1.default.cwd)}`, loaded).catch(_e => {
            // noop
        });
    }
    previous() {
        let { current, index } = this;
        if (!current || !current.length)
            return;
        if (index <= 0) {
            this.index = current.length - 1;
        }
        else {
            this.index = index - 1;
        }
        this.manager.prompt.input = current[this.index] || '';
    }
    next() {
        let { current, index } = this;
        if (!current || !current.length)
            return;
        if (index == current.length - 1) {
            this.index = 0;
        }
        else {
            this.index = index + 1;
        }
        this.manager.prompt.input = current[this.index] || '';
    }
}
exports.default = History;
//# sourceMappingURL=history.js.map