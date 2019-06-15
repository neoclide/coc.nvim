"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
exports.validKeys = [
    '<esc>',
    '<tab>',
    '<s-tab>',
    '<bs>',
    '<right>',
    '<left>',
    '<up>',
    '<down>',
    '<home>',
    '<end>',
    '<cr>',
    '<FocusGained>',
    '<ScrollWheelUp>',
    '<ScrollWheelDown>',
    '<LeftMouse>',
    '<LeftDrag>',
    '<LeftRelease>',
    '<2-LeftMouse>',
    '<C-a>',
    '<C-b>',
    '<C-c>',
    '<C-d>',
    '<C-e>',
    '<C-f>',
    '<C-g>',
    '<C-h>',
    '<C-i>',
    '<C-j>',
    '<C-k>',
    '<C-l>',
    '<C-m>',
    '<C-n>',
    '<C-o>',
    '<C-p>',
    '<C-q>',
    '<C-r>',
    '<C-s>',
    '<C-t>',
    '<C-u>',
    '<C-v>',
    '<C-w>',
    '<C-x>',
    '<C-y>',
    '<C-z>',
    '<A-a>',
    '<A-b>',
    '<A-c>',
    '<A-d>',
    '<A-e>',
    '<A-f>',
    '<A-g>',
    '<A-h>',
    '<A-i>',
    '<A-j>',
    '<A-k>',
    '<A-l>',
    '<A-m>',
    '<A-n>',
    '<A-o>',
    '<A-p>',
    '<A-q>',
    '<A-r>',
    '<A-s>',
    '<A-t>',
    '<A-u>',
    '<A-v>',
    '<A-w>',
    '<A-x>',
    '<A-y>',
    '<A-z>',
];
class ListConfiguration {
    constructor() {
        this.configuration = workspace_1.default.getConfiguration('list');
        this.disposable = workspace_1.default.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('list')) {
                this.configuration = workspace_1.default.getConfiguration('list');
            }
        });
    }
    get(key, defaultValue) {
        return this.configuration.get(key, defaultValue);
    }
    get previousKey() {
        return this.fixKey(this.configuration.get('previousKeymap', '<C-j>'));
    }
    get nextKey() {
        return this.fixKey(this.configuration.get('nextKeymap', '<C-k>'));
    }
    dispose() {
        this.disposable.dispose();
    }
    fixKey(key) {
        if (exports.validKeys.indexOf(key) !== -1)
            return key;
        let find = exports.validKeys.find(s => s.toLowerCase() == key.toLowerCase());
        if (find)
            return find;
        workspace_1.default.showMessage(`Configured key "${key}" invalid.`, 'error');
        return null;
    }
}
exports.default = ListConfiguration;
//# sourceMappingURL=configuration.js.map