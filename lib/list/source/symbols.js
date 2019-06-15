"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const vscode_uri_1 = require("vscode-uri");
const languages_1 = tslib_1.__importDefault(require("../../languages"));
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const location_1 = tslib_1.__importDefault(require("./location"));
const convert_1 = require("../../util/convert");
const fs_1 = require("../../util/fs");
const logger = require('../../util/logger')('list-symbols');
class Symbols extends location_1.default {
    constructor() {
        super(...arguments);
        this.interactive = true;
        this.description = 'search workspace symbols';
        this.detail = 'Symbols list if provided by server, it works on interactive mode only.\n';
        this.name = 'symbols';
    }
    async loadItems(context) {
        let buf = await context.window.buffer;
        let document = workspace_1.default.getDocument(buf.id);
        if (!document)
            return null;
        let { input } = context;
        if (!context.options.interactive) {
            throw new Error('Symbols only works on interactive mode');
        }
        let symbols = await languages_1.default.getWorkspaceSymbols(document.textDocument, input);
        if (!symbols) {
            throw new Error('Workspace symbols provider not found for current document');
        }
        let items = [];
        for (let s of symbols) {
            if (!this.validWorkspaceSymbol(s))
                continue;
            let kind = convert_1.getSymbolKind(s.kind);
            let file = vscode_uri_1.URI.parse(s.location.uri).fsPath;
            if (fs_1.isParentFolder(workspace_1.default.cwd, file)) {
                file = path_1.default.relative(workspace_1.default.cwd, file);
            }
            items.push({
                label: `${s.name} [${kind}]\t${file}`,
                filterText: `${s.name}`,
                location: s.location,
                data: { original: s }
            });
        }
        return items;
    }
    async resolveItem(item) {
        let s = item.data.original;
        if (!s)
            return null;
        let resolved = await languages_1.default.resolveWorkspaceSymbol(s);
        if (!resolved)
            return null;
        let kind = convert_1.getSymbolKind(resolved.kind);
        let file = vscode_uri_1.URI.parse(resolved.location.uri).fsPath;
        if (fs_1.isParentFolder(workspace_1.default.cwd, file)) {
            file = path_1.default.relative(workspace_1.default.cwd, file);
        }
        return {
            label: `${s.name} [${kind}]\t${file}`,
            filterText: `${s.name}`,
            location: s.location
        };
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocSymbolsName /\\v^\\s*\\S+/ contained containedin=CocSymbolsLine', true);
        nvim.command('syntax match CocSymbolsKind /\\[\\w\\+\\]\\t/ contained containedin=CocSymbolsLine', true);
        nvim.command('syntax match CocSymbolsFile /\\S\\+$/ contained containedin=CocSymbolsLine', true);
        nvim.command('highlight default link CocSymbolsName Normal', true);
        nvim.command('highlight default link CocSymbolsKind Typedef', true);
        nvim.command('highlight default link CocSymbolsFile Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
    validWorkspaceSymbol(symbol) {
        switch (symbol.kind) {
            case vscode_languageserver_types_1.SymbolKind.Namespace:
            case vscode_languageserver_types_1.SymbolKind.Class:
            case vscode_languageserver_types_1.SymbolKind.Module:
            case vscode_languageserver_types_1.SymbolKind.Method:
            case vscode_languageserver_types_1.SymbolKind.Package:
            case vscode_languageserver_types_1.SymbolKind.Interface:
            case vscode_languageserver_types_1.SymbolKind.Function:
            case vscode_languageserver_types_1.SymbolKind.Constant:
                return true;
            default:
                return false;
        }
    }
}
exports.default = Symbols;
//# sourceMappingURL=symbols.js.map