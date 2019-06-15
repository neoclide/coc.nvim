"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
class OutputList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'open';
        this.name = 'output';
        this.description = 'output channels of coc.nvim';
        this.addAction('open', async (item) => {
            workspace_1.default.showOutputChannel(item.label);
        });
    }
    async loadItems(_context) {
        let names = workspace_1.default.channelNames;
        return names.map(n => {
            return { label: n };
        });
    }
}
exports.default = OutputList;
//# sourceMappingURL=output.js.map