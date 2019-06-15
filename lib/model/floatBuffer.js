"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const highlight_1 = require("../util/highlight");
const string_1 = require("../util/string");
const array_1 = require("../util/array");
const workspace_1 = tslib_1.__importDefault(require("../workspace"));
const logger = require('../util/logger')('model-floatBuffer');
class FloatBuffer {
    constructor(nvim, buffer, window) {
        this.nvim = nvim;
        this.buffer = buffer;
        this.window = window;
        this.lines = [];
        this.positions = [];
        this.enableHighlight = true;
        this.width = 0;
        let config = workspace_1.default.getConfiguration('coc.preferences');
        this.enableHighlight = config.get('enableFloatHighlight', true);
    }
    getHeight(docs, maxWidth) {
        let l = 0;
        for (let doc of docs) {
            let lines = doc.content.split(/\r?\n/);
            if (doc.filetype == 'markdown' && workspace_1.default.isNvim) {
                lines = lines.filter(s => !s.startsWith('```'));
            }
            for (let line of lines) {
                l = l + Math.max(1, Math.ceil(string_1.byteLength(line) / (maxWidth - 4)));
            }
        }
        return l + docs.length - 1;
    }
    get valid() {
        return this.buffer.valid;
    }
    calculateFragments(docs, maxWidth) {
        let fragments = [];
        let idx = 0;
        let currLine = 0;
        let newLines = [];
        let fill = false;
        let positions = this.positions = [];
        for (let doc of docs) {
            let lines = [];
            let content = doc.content.replace(/\s+$/, '');
            let arr = content.split(/\r?\n/);
            if (['Error', 'Info', 'Warning', 'Hint'].indexOf(doc.filetype) !== -1) {
                fill = true;
            }
            // let [start, end] = doc.active || []
            for (let str of arr) {
                lines.push(str);
                if (doc.active) {
                    let part = str.slice(doc.active[0], doc.active[1]);
                    positions.push([currLine + 1, doc.active[0] + 1, string_1.byteLength(part)]);
                }
            }
            fragments.push({
                start: currLine,
                lines,
                filetype: doc.filetype
            });
            newLines.push(...lines.filter(s => !/^\s*```/.test(s)));
            if (idx != docs.length - 1) {
                newLines.push('—');
                currLine = newLines.length;
            }
            idx = idx + 1;
        }
        let width = this.width = Math.min(Math.max(...newLines.map(s => string_1.byteLength(s))) + 2, maxWidth);
        this.lines = newLines.map(s => {
            if (s == '—')
                return '—'.repeat(width - 2);
            return s;
        });
        return fragments;
    }
    async setDocuments(docs, maxWidth) {
        let fragments = this.calculateFragments(docs, maxWidth);
        let filetype = await this.nvim.eval('&filetype');
        if (workspace_1.default.isNvim) {
            fragments = fragments.reduce((p, c) => {
                p.push(...this.splitFragment(c, filetype));
                return p;
            }, []);
        }
        if (this.enableHighlight) {
            let arr = await Promise.all(fragments.map(f => {
                return highlight_1.getHiglights(f.lines, f.filetype).then(highlights => {
                    return highlights.map(highlight => {
                        return Object.assign({}, highlight, { line: highlight.line + f.start });
                    });
                });
            }));
            this.highlights = arr.reduce((p, c) => p.concat(c), []);
        }
        else {
            this.highlights = [];
        }
    }
    splitFragment(fragment, defaultFileType) {
        let res = [];
        let filetype = fragment.filetype;
        let lines = [];
        let curr = fragment.start;
        let inBlock = false;
        for (let line of fragment.lines) {
            let ms = line.match(/^\s*```\s*(\w+)?/);
            if (ms != null) {
                if (lines.length) {
                    res.push({ lines, filetype: this.fixFiletype(filetype), start: curr - lines.length });
                    lines = [];
                }
                inBlock = !inBlock;
                filetype = inBlock ? ms[1] || defaultFileType : fragment.filetype;
            }
            else {
                lines.push(line);
                curr = curr + 1;
            }
        }
        if (lines.length) {
            res.push({ lines, filetype: this.fixFiletype(filetype), start: curr - lines.length });
            lines = [];
        }
        return res;
    }
    fixFiletype(filetype) {
        if (filetype == 'ts')
            return 'typescript';
        if (filetype == 'js')
            return 'javascript';
        if (filetype == 'bash')
            return 'sh';
        return filetype;
    }
    setLines() {
        let { buffer, lines, nvim, highlights } = this;
        if (this.window) {
            nvim.call('win_execute', [this.window.id, 'call clearmatches([])'], true);
        }
        else {
            nvim.call('clearmatches', [], true);
        }
        buffer.clearNamespace(-1, 0, -1);
        buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true);
        if (highlights.length) {
            let positions = [];
            for (let highlight of highlights) {
                buffer.addHighlight(Object.assign({ srcId: workspace_1.default.createNameSpace('coc-float') }, highlight)).catch(_e => {
                    // noop
                });
                if (highlight.isMarkdown) {
                    let line = lines[highlight.line];
                    let before = line[string_1.characterIndex(line, highlight.colStart)];
                    let after = line[string_1.characterIndex(line, highlight.colEnd) - 1];
                    if (before == after && ['_', '`', '*'].indexOf(before) !== -1) {
                        positions.push([highlight.line + 1, highlight.colStart + 1]);
                        positions.push([highlight.line + 1, highlight.colEnd]);
                    }
                    if (highlight.colEnd - highlight.colStart == 2 && before == '\\') {
                        positions.push([highlight.line + 1, highlight.colStart + 1]);
                    }
                }
            }
            for (let arr of array_1.group(positions, 8)) {
                if (this.window) {
                    nvim.call('win_execute', [this.window.id, `call matchaddpos('Conceal', ${JSON.stringify(arr)},11)`], true);
                }
                else {
                    nvim.call('matchaddpos', ['Conceal', arr, 11], true);
                }
            }
        }
        for (let arr of array_1.group(this.positions || [], 8)) {
            arr = arr.filter(o => o[2] != 0);
            if (arr.length) {
                if (this.window) {
                    nvim.call('win_execute', [this.window.id, `call matchaddpos('CocUnderline', ${JSON.stringify(arr)},12)`], true);
                }
                else {
                    nvim.call('matchaddpos', ['CocUnderline', arr, 12], true);
                }
            }
        }
    }
}
exports.default = FloatBuffer;
//# sourceMappingURL=floatBuffer.js.map