"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("../config");
class Source {
    constructor(nvim, option) {
        this.nvim = nvim;
        this.name = option.name;
        this.shortcut = option.shortcut;
        this.priority = option.priority || 0;
        this.filetypes = option.filetypes || null;
        this.engross = !!option.engross;
        this.filter = option.filter;
        if (option.shortcut) {
            this.menu = `[${option.shortcut}]`;
        }
        else {
            this.menu = `[${option.name.slice(0, 5)}]`;
        }
        this.disabled = false;
    }
    checkFileType(filetype) {
        if (this.filetypes == null)
            return true;
        return this.filetypes.indexOf(filetype) !== -1;
    }
    getFilter() {
        let { filter } = this;
        if (!filter)
            return null;
        if (filter === 'remote') {
            return config_1.getConfig('fuzzyMatch') ? 'fuzzy' : 'word';
        }
        return filter == 'word' ? 'word' : 'fuzzy';
    }
}
exports.default = Source;
//# sourceMappingURL=source.js.map