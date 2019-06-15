"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const fs_1 = require("../../util/fs");
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
class FoldList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'edit';
        this.description = 'list of current workspace folders';
        this.name = 'folders';
        this.addAction('edit', async (item) => {
            let newPath = await nvim.call('input', ['Folder:', item.label, 'file']);
            let stat = await fs_1.statAsync(newPath);
            if (!stat || !stat.isDirectory()) {
                await nvim.command(`echoerr "invalid path: ${newPath}"`);
                return;
            }
            workspace_1.default.renameWorkspaceFolder(item.label, newPath);
        }, { reload: true, persist: true });
        this.addAction('delete', async (item) => {
            workspace_1.default.removeWorkspaceFolder(item.label);
        }, { reload: true, persist: true });
    }
    async loadItems(_context) {
        return workspace_1.default.folderPaths.map(p => {
            return { label: p };
        });
    }
}
exports.default = FoldList;
//# sourceMappingURL=folders.js.map