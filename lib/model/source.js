"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Source {
    constructor(nvim, option) {
        this.nvim = nvim;
        this.name = option.name;
        this.shortcut = option.shortcut;
        this.priority = option.priority || 0;
        this.filetypes = option.filetypes || [];
        this.engross = !!option.engross;
        this.filter = option.filter;
        if (option.shortcut) {
            this.menu = `[${option.shortcut}]`;
        }
        else {
            this.menu = `[${option.name.slice(0, 5)}]`;
        }
    }
}
exports.default = Source;
//# sourceMappingURL=source.js.map