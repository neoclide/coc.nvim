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
        return __awaiter(this, void 0, void 0, function* () {
            // do nothing
        });
    }
}
exports.default = Source;
//# sourceMappingURL=source.js.map