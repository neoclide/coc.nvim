"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Source {
    constructor(nvim, option) {
        this.nvim = nvim;
        this.name = option.name;
        this.shortcut = option.shortcut;
        this.priority = option.priority || 0;
        this.filetypes = option.filetypes || null;
        this.engross = !!option.engross;
        this.filter = option.filter == 'word' ? 'word' : 'fuzzy';
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
}
exports.default = Source;
//# sourceMappingURL=source.js.map