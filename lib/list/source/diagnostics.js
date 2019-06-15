"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const manager_1 = tslib_1.__importDefault(require("../../diagnostic/manager"));
const location_1 = tslib_1.__importDefault(require("./location"));
const fs_1 = require("../../util/fs");
const logger = require('../../util/logger')('list-symbols');
class DiagnosticsList extends location_1.default {
    constructor() {
        super(...arguments);
        this.defaultAction = 'open';
        this.description = 'diagnostics of current workspace';
        this.name = 'diagnostics';
    }
    async loadItems(context) {
        let list = manager_1.default.getDiagnosticList();
        let { cwd } = context;
        return list.map(item => {
            let file = fs_1.isParentFolder(cwd, item.file) ? path_1.default.relative(cwd, item.file) : item.file;
            return {
                label: `${file}:${item.lnum}:${item.col}\t${item.severity}\t${item.message.replace(/\n/g, '')}`,
                location: item.location
            };
        });
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocDiagnosticsFile /\\v^\\s*\\S+/ contained containedin=CocDiagnosticsLine', true);
        nvim.command('syntax match CocDiagnosticsError /\\tError\\t/ contained containedin=CocDiagnosticsLine', true);
        nvim.command('syntax match CocDiagnosticsWarning /\\tWarning\\t/ contained containedin=CocDiagnosticsLine', true);
        nvim.command('syntax match CocDiagnosticsInfo /\\tInformation\\t/ contained containedin=CocDiagnosticsLine', true);
        nvim.command('syntax match CocDiagnosticsHint /\\tHint\\t/ contained containedin=CocDiagnosticsLine', true);
        nvim.command('highlight default link CocDiagnosticsFile Comment', true);
        nvim.command('highlight default link CocDiagnosticsError CocErrorSign', true);
        nvim.command('highlight default link CocDiagnosticsWarning CocWarningSign', true);
        nvim.command('highlight default link CocDiagnosticsInfo CocInfoSign', true);
        nvim.command('highlight default link CocDiagnosticsHint CocHintSign', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = DiagnosticsList;
//# sourceMappingURL=diagnostics.js.map