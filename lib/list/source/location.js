"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const path_1 = tslib_1.__importDefault(require("path"));
const basic_1 = tslib_1.__importDefault(require("../basic"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const vscode_uri_1 = require("vscode-uri");
const fs_1 = require("../../util/fs");
const logger = require('../../util/logger')('list-location');
class LocationList extends basic_1.default {
    constructor(nvim) {
        super(nvim);
        this.defaultAction = 'open';
        this.description = 'last jump locations';
        this.name = 'location';
        this.addLocationActions();
    }
    async loadItems(context) {
        // filename, lnum, col, text, type
        let locs = global.locations;
        locs = locs || [];
        locs.forEach(loc => {
            if (!loc.uri) {
                let fullpath = path_1.default.isAbsolute(loc.filename) ? loc.filename : path_1.default.join(context.cwd, loc.filename);
                loc.uri = vscode_uri_1.URI.file(fullpath).toString();
            }
            if (!loc.bufnr && workspace_1.default.getDocument(loc.uri) != null) {
                loc.bufnr = workspace_1.default.getDocument(loc.uri).bufnr;
            }
            if (!loc.range) {
                let { lnum, col } = loc;
                loc.range = vscode_languageserver_types_1.Range.create(lnum - 1, col - 1, lnum - 1, col - 1);
            }
            else {
                loc.lnum = loc.lnum || loc.range.start.line + 1;
                loc.col = loc.col || loc.range.start.character + 1;
            }
        });
        let bufnr = await this.nvim.call('bufnr', '%');
        let ignoreFilepath = locs.every(o => o.bufnr && bufnr && o.bufnr == bufnr);
        let items = locs.map(loc => {
            let filename = ignoreFilepath ? '' : loc.filename;
            let filterText = `${filename}${loc.text.trim()}`;
            if (path_1.default.isAbsolute(filename)) {
                filename = fs_1.isParentFolder(context.cwd, filename) ? path_1.default.relative(context.cwd, filename) : filename;
            }
            return {
                label: `${filename} |${loc.type ? loc.type + ' ' : ''}${loc.lnum} col ${loc.col}| ${loc.text}`,
                location: vscode_languageserver_types_1.Location.create(loc.uri, loc.range),
                filterText
            };
        });
        return items;
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocLocationName /\\v^[^|]+/ contained containedin=CocLocationLine', true);
        nvim.command('syntax match CocLocationPosition /\\v\\|\\w*\\s?\\d+\\scol\\s\\d+\\|/ contained containedin=CocLocationLine', true);
        nvim.command('syntax match CocLocationError /Error/ contained containedin=CocLocationPosition', true);
        nvim.command('syntax match CocLocationWarning /Warning/ contained containedin=CocLocationPosition', true);
        nvim.command('highlight default link CocLocationName Directory', true);
        nvim.command('highlight default link CocLocationPosition LineNr', true);
        nvim.command('highlight default link CocLocationError Error', true);
        nvim.command('highlight default link CocLocationWarning WarningMsg', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
}
exports.default = LocationList;
//# sourceMappingURL=location.js.map