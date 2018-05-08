"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const config_1 = require("../config");
class Source {
    constructor(nvim, option) {
        let { shortcut, filetypes, name } = option;
        filetypes = Array.isArray(filetypes) ? filetypes : null;
        this.nvim = nvim;
        this.name = name;
        this.engross = !!option.engross;
        let opt = config_1.getSourceConfig(name) || {};
        shortcut = opt.shortcut || shortcut;
        this.filetypes = opt.filetypes || filetypes;
        if (!shortcut) {
            this.shortcut = name.slice(0, 3).toUpperCase();
        }
        else {
            this.shortcut = shortcut.slice(0, 3).toUpperCase();
        }
    }
    get menu() {
        return `[${this.shortcut}]`;
    }
    checkFileType(filetype) {
        if (this.filetypes == null)
            return true;
        return this.filetypes.indexOf(filetype) !== -1;
    }
    // some source could overwrite it
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            // do nothing
        });
    }
}
exports.default = Source;
//# sourceMappingURL=source.js.map