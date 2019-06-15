"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const path_1 = tslib_1.__importDefault(require("path"));
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
const vscode_uri_1 = require("vscode-uri");
const languages_1 = tslib_1.__importDefault(require("../../languages"));
const util_1 = require("../../util");
const fs_1 = require("../../util/fs");
const workspace_1 = tslib_1.__importDefault(require("../../workspace"));
const location_1 = tslib_1.__importDefault(require("./location"));
const convert_1 = require("../../util/convert");
const logger = require('../../util/logger')('list-symbols');
class Outline extends location_1.default {
    constructor() {
        super(...arguments);
        this.description = 'symbols of current document';
        this.name = 'outline';
    }
    async loadItems(context) {
        let buf = await context.window.buffer;
        let document = workspace_1.default.getDocument(buf.id);
        if (!document)
            return null;
        let config = this.getConfig();
        let ctagsFilestypes = config.get('ctagsFilestypes', []);
        let symbols;
        if (ctagsFilestypes.indexOf(document.filetype) == -1) {
            symbols = await languages_1.default.getDocumentSymbol(document.textDocument);
        }
        if (!symbols)
            return await this.loadCtagsSymbols(document);
        if (symbols.length == 0)
            return [];
        let items = [];
        let isSymbols = !symbols[0].hasOwnProperty('location');
        if (isSymbols) {
            function addSymbols(symbols, level = 0) {
                symbols.sort(sortSymbols);
                for (let s of symbols) {
                    let kind = convert_1.getSymbolKind(s.kind);
                    if (kind == 'Variable' || s.name.endsWith(') callback'))
                        continue;
                    let location = vscode_languageserver_types_1.Location.create(document.uri, s.selectionRange);
                    items.push({
                        label: `${' '.repeat(level * 2)}${s.name} [${kind}] ${s.range.start.line + 1}`,
                        filterText: `${s.name}`,
                        location
                    });
                    if (s.children && s.children.length) {
                        addSymbols(s.children, level + 1);
                    }
                }
            }
            addSymbols(symbols);
        }
        else {
            symbols.sort((a, b) => {
                let sa = a.location.range.start;
                let sb = b.location.range.start;
                let d = sa.line - sb.line;
                return d == 0 ? sa.character - sb.character : d;
            });
            for (let s of symbols) {
                let kind = convert_1.getSymbolKind(s.kind);
                if (s.name.endsWith(') callback'))
                    continue;
                items.push({
                    label: `${s.name} [${kind}] ${s.location.range.start.line + 1}`,
                    filterText: `${s.name}`,
                    location: s.location
                });
            }
        }
        return items;
    }
    doHighlight() {
        let { nvim } = this;
        nvim.pauseNotification();
        nvim.command('syntax match CocOutlineName /\\v^\\s*\\S+/ contained containedin=CocOutlineLine', true);
        nvim.command('syntax match CocOutlineKind /\\[\\w\\+\\]/ contained containedin=CocOutlineLine', true);
        nvim.command('syntax match CocOutlineLine /\\d\\+$/ contained containedin=CocOutlineLine', true);
        nvim.command('highlight default link CocOutlineName Normal', true);
        nvim.command('highlight default link CocOutlineKind Typedef', true);
        nvim.command('highlight default link CocOutlineLine Comment', true);
        nvim.resumeNotification().catch(_e => {
            // noop
        });
    }
    async loadCtagsSymbols(document) {
        let uri = vscode_uri_1.URI.parse(document.uri);
        let extname = path_1.default.extname(uri.fsPath);
        let content = '';
        let tempname = await this.nvim.call('tempname');
        let filepath = `${tempname}.${extname}`;
        let escaped = await this.nvim.call('fnameescape', filepath);
        await fs_1.writeFile(escaped, document.getDocumentContent());
        try {
            content = await util_1.runCommand(`ctags -f - --excmd=number --language-force=${document.filetype} ${escaped}`);
        }
        catch (e) {
            // noop
        }
        if (!content.trim().length) {
            content = await util_1.runCommand(`ctags -f - --excmd=number ${escaped}`);
        }
        content = content.trim();
        if (!content)
            return [];
        let lines = content.split('\n');
        let items = [];
        for (let line of lines) {
            let parts = line.split('\t');
            if (parts.length < 4)
                continue;
            let lnum = Number(parts[2].replace(/;"$/, ''));
            let text = document.getline(lnum - 1);
            if (!text)
                continue;
            let idx = text.indexOf(parts[0]);
            let start = idx == -1 ? 0 : idx;
            let range = vscode_languageserver_types_1.Range.create(lnum - 1, start, lnum - 1, start + parts[0].length);
            items.push({
                label: `${parts[0]} [${parts[3]}] ${lnum}`,
                filterText: parts[0],
                location: vscode_languageserver_types_1.Location.create(document.uri, range),
                data: { line: lnum }
            });
        }
        items.sort((a, b) => {
            return a.data.line - b.data.line;
        });
        return items;
    }
}
exports.default = Outline;
function sortSymbols(a, b) {
    let ra = a.selectionRange;
    let rb = b.selectionRange;
    if (ra.start.line != rb.start.line) {
        return ra.start.line - rb.start.line;
    }
    return ra.start.character - rb.start.character;
}
//# sourceMappingURL=outline.js.map