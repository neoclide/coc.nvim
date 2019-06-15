"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const debounce_1 = tslib_1.__importDefault(require("debounce"));
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const diff_1 = require("../util/diff");
const fs_1 = require("../util/fs");
const index_1 = require("../util/index");
const string_1 = require("../util/string");
const chars_1 = require("./chars");
const array_1 = require("../util/array");
const logger = require('../util/logger')('model-document');
// wrapper class of TextDocument
class Document {
    constructor(buffer, env) {
        this.buffer = buffer;
        this.env = env;
        this.paused = false;
        this.isIgnored = false;
        // vim only, for matchaddpos
        this.colorId = 1080;
        this.eol = true;
        this.attached = false;
        // real current lines
        this.lines = [];
        this._additionalKeywords = [];
        this._words = [];
        this._onDocumentChange = new vscode_languageserver_protocol_1.Emitter();
        this._onDocumentDetach = new vscode_languageserver_protocol_1.Emitter();
        this.onDocumentChange = this._onDocumentChange.event;
        this.onDocumentDetach = this._onDocumentDetach.event;
        this.fireContentChanges = debounce_1.default(() => {
            this._fireContentChanges();
        }, 200);
        this.fetchContent = debounce_1.default(() => {
            this._fetchContent().catch(e => {
                logger.error(`Error on fetch content:`, e);
            });
        }, 50);
    }
    get shouldAttach() {
        let { buftype } = this;
        if (this.uri.endsWith('%5BCommand%20Line%5D'))
            return true;
        return buftype == '' || buftype == 'acwrite';
    }
    get words() {
        return this._words;
    }
    setFiletype(filetype) {
        let { uri, version } = this;
        this._filetype = this.convertFiletype(filetype);
        version = version ? version + 1 : 1;
        let textDocument = vscode_languageserver_protocol_1.TextDocument.create(uri, this.filetype, version, this.content);
        this.textDocument = textDocument;
    }
    convertFiletype(filetype) {
        let map = this.env.filetypeMap;
        if (filetype == 'json' && this.uri && this.uri.endsWith('coc-settings.json')) {
            return 'jsonc';
        }
        if (filetype == 'javascript.jsx')
            return 'javascriptreact';
        if (filetype == 'typescript.jsx' || filetype == 'typescript.tsx')
            return 'typescriptreact';
        return map[filetype] || filetype;
    }
    /**
     * Current changedtick of buffer
     *
     * @public
     * @returns {number}
     */
    get changedtick() {
        return this._changedtick;
    }
    get schema() {
        return vscode_uri_1.URI.parse(this.uri).scheme;
    }
    get lineCount() {
        return this.lines.length;
    }
    async init(nvim, token) {
        this.nvim = nvim;
        let { buffer } = this;
        let opts = await nvim.call('coc#util#get_bufoptions', buffer.id);
        if (opts == null)
            return false;
        let buftype = this.buftype = opts.buftype;
        this.variables = opts.variables;
        this._additionalKeywords = opts.additionalKeywords;
        this._changedtick = opts.changedtick;
        this._rootPatterns = opts.rootPatterns;
        this.eol = opts.eol == 1;
        let uri = this._uri = index_1.getUri(opts.fullpath, buffer.id, buftype);
        token.onCancellationRequested(() => {
            this.detach();
        });
        try {
            if (!this.env.isVim) {
                let res = await this.attach();
                if (!res)
                    return false;
            }
            else {
                this.lines = await buffer.lines;
            }
            this.attached = true;
        }
        catch (e) {
            logger.error('attach error:', e);
            return false;
        }
        this._filetype = this.convertFiletype(opts.filetype);
        this.textDocument = vscode_languageserver_protocol_1.TextDocument.create(uri, this.filetype, 1, this.getDocumentContent());
        this.setIskeyword(opts.iskeyword);
        this.gitCheck();
        if (token.isCancellationRequested)
            return false;
        return true;
    }
    setIskeyword(iskeyword) {
        let chars = (this.chars = new chars_1.Chars(iskeyword));
        for (let ch of this._additionalKeywords) {
            chars.addKeyword(ch);
        }
        this._words = this.chars.matchKeywords(this.lines.join('\n'));
    }
    async attach() {
        if (this.shouldAttach) {
            let attached = await this.buffer.attach(false);
            if (!attached)
                return false;
            this.lines = await this.buffer.lines;
        }
        else {
            this.lines = await this.buffer.lines;
            return true;
        }
        if (!this.buffer.isAttached)
            return;
        this.buffer.listen('lines', (...args) => {
            this.onChange.apply(this, args);
        });
        this.buffer.listen('detach', async () => {
            await index_1.wait(30);
            if (!this.attached)
                return;
            // it could be detached by `edit!`
            let attached = await this.attach();
            if (!attached)
                this.detach();
        });
        this.buffer.listen('changedtick', (_buf, tick) => {
            this._changedtick = tick;
        });
        if (this.textDocument) {
            this.fireContentChanges();
        }
        return true;
    }
    onChange(buf, tick, firstline, lastline, linedata
    // more:boolean
    ) {
        if (buf.id !== this.buffer.id || tick == null)
            return;
        this._changedtick = tick;
        let lines = this.lines.slice(0, firstline);
        lines = lines.concat(linedata, this.lines.slice(lastline));
        this.lines = lines;
        this.fireContentChanges();
    }
    /**
     * Make sure current document synced correctly
     *
     * @public
     * @returns {Promise<void>}
     */
    async checkDocument() {
        this.paused = false;
        let { buffer } = this;
        this._changedtick = await buffer.changedtick;
        this.lines = await buffer.lines;
        this.fireContentChanges.clear();
        this._fireContentChanges();
    }
    get dirty() {
        return this.content != this.getDocumentContent();
    }
    _fireContentChanges(force = false) {
        let { paused, textDocument } = this;
        if (paused && !force)
            return;
        try {
            let content = this.getDocumentContent();
            let change = diff_1.getChange(this.content, content);
            if (change == null)
                return;
            this.createDocument();
            let { version, uri } = this;
            let start = textDocument.positionAt(change.start);
            let end = textDocument.positionAt(change.end);
            let changes = [{
                    range: { start, end },
                    rangeLength: change.end - change.start,
                    text: change.newText
                }];
            logger.debug('changes:', JSON.stringify(changes, null, 2));
            this._onDocumentChange.fire({
                textDocument: { version, uri },
                contentChanges: changes
            });
            this._words = this.chars.matchKeywords(this.lines.join('\n'));
        }
        catch (e) {
            logger.error(e.message);
        }
    }
    detach() {
        // neovim not detach on `:checktime`
        if (this.attached) {
            this.attached = false;
            this.buffer.detach().catch(_e => {
                // noop
            });
            this._onDocumentDetach.fire(this.uri);
        }
        this.fetchContent.clear();
        this.fireContentChanges.clear();
        this._onDocumentChange.dispose();
        this._onDocumentDetach.dispose();
    }
    get bufnr() {
        return this.buffer.id;
    }
    get content() {
        return this.textDocument.getText();
    }
    get filetype() {
        return this._filetype;
    }
    get uri() {
        return this._uri;
    }
    get version() {
        return this.textDocument ? this.textDocument.version : null;
    }
    async applyEdits(_nvim, edits, sync = true) {
        if (edits.length == 0)
            return;
        let orig = this.lines.join('\n') + (this.eol ? '\n' : '');
        let textDocument = vscode_languageserver_protocol_1.TextDocument.create(this.uri, this.filetype, 1, orig);
        let content = vscode_languageserver_protocol_1.TextDocument.applyEdits(textDocument, edits);
        // could be equal sometimes
        if (orig === content) {
            this.createDocument();
        }
        else {
            let d = diff_1.diffLines(orig, content);
            await this.buffer.setLines(d.replacement, {
                start: d.start,
                end: d.end,
                strictIndexing: false
            });
            // can't wait vim sync buffer
            this.lines = (this.eol && content.endsWith('\n') ? content.slice(0, -1) : content).split('\n');
            if (sync)
                this.forceSync();
        }
    }
    forceSync(ignorePause = true) {
        this.fireContentChanges.clear();
        this._fireContentChanges(ignorePause);
    }
    getOffset(lnum, col) {
        return this.textDocument.offsetAt({
            line: lnum - 1,
            character: col
        });
    }
    isWord(word) {
        return this.chars.isKeyword(word);
    }
    getMoreWords() {
        let res = [];
        let { words, chars } = this;
        if (!chars.isKeywordChar('-'))
            return res;
        for (let word of words) {
            word = word.replace(/^-+/, '');
            if (word.indexOf('-') !== -1) {
                let parts = word.split('-');
                for (let part of parts) {
                    if (part.length > 2 &&
                        res.indexOf(part) === -1 &&
                        words.indexOf(part) === -1) {
                        res.push(part);
                    }
                }
            }
        }
        return res;
    }
    /**
     * Current word for replacement
     */
    getWordRangeAtPosition(position, extraChars, current = true) {
        let chars = this.chars.clone();
        if (extraChars && extraChars.length) {
            for (let ch of extraChars) {
                chars.addKeyword(ch);
            }
        }
        let line = this.getline(position.line, current);
        if (line.length == 0 || position.character >= line.length)
            return null;
        if (!chars.isKeywordChar(line[position.character]))
            return null;
        let start = position.character;
        let end = position.character + 1;
        if (!chars.isKeywordChar(line[start])) {
            return vscode_languageserver_protocol_1.Range.create(position, { line: position.line, character: position.character + 1 });
        }
        while (start >= 0) {
            let ch = line[start - 1];
            if (!ch || !chars.isKeyword(ch))
                break;
            start = start - 1;
        }
        while (end <= line.length) {
            let ch = line[end];
            if (!ch || !chars.isKeywordChar(ch))
                break;
            end = end + 1;
        }
        return vscode_languageserver_protocol_1.Range.create(position.line, start, position.line, end);
    }
    gitCheck() {
        let { uri } = this;
        if (!uri.startsWith('file') || this.buftype != '')
            return;
        let filepath = vscode_uri_1.URI.parse(uri).fsPath;
        fs_1.isGitIgnored(filepath).then(isIgnored => {
            this.isIgnored = isIgnored;
        }, () => {
            this.isIgnored = false;
        });
    }
    createDocument(changeCount = 1) {
        let { version, uri, filetype } = this;
        version = version + changeCount;
        this.textDocument = vscode_languageserver_protocol_1.TextDocument.create(uri, filetype, version, this.getDocumentContent());
    }
    async _fetchContent() {
        if (!this.env.isVim || !this.attached)
            return;
        let { nvim, buffer } = this;
        let { id } = buffer;
        let o = (await nvim.call('coc#util#get_content', id));
        if (!o)
            return;
        let { content, changedtick } = o;
        this._changedtick = changedtick;
        let newLines = content.split('\n');
        this.lines = newLines;
        this._fireContentChanges();
    }
    async patchChange() {
        if (!this.env.isVim || !this.attached)
            return;
        let change = await this.nvim.call('coc#util#get_changeinfo', []);
        if (change.changedtick == this._changedtick)
            return;
        let { lines } = this;
        let { lnum, line, changedtick } = change;
        this._changedtick = changedtick;
        lines[lnum - 1] = line;
    }
    getSymbolRanges(word) {
        this.forceSync();
        let { textDocument } = this;
        let res = [];
        let content = textDocument.getText();
        let str = '';
        for (let i = 0, l = content.length; i < l; i++) {
            let ch = content[i];
            if ('-' == ch && str.length == 0) {
                continue;
            }
            let isKeyword = this.chars.isKeywordChar(ch);
            if (isKeyword) {
                str = str + ch;
            }
            if (str.length > 0 && !isKeyword && str == word) {
                res.push(vscode_languageserver_protocol_1.Range.create(textDocument.positionAt(i - str.length), textDocument.positionAt(i)));
            }
            if (!isKeyword) {
                str = '';
            }
        }
        return res;
    }
    async patchChangedTick() {
        if (!this.env.isVim || !this.attached)
            return;
        this._changedtick = await this.nvim.call('getbufvar', [this.bufnr, 'changedtick']);
    }
    fixStartcol(position, valids) {
        let line = this.getline(position.line);
        if (!line)
            return null;
        let { character } = position;
        let start = line.slice(0, character);
        let col = string_1.byteLength(start);
        let { chars } = this;
        for (let i = start.length - 1; i >= 0; i--) {
            let c = start[i];
            if (c == ' ')
                break;
            if (!chars.isKeywordChar(c) && valids.indexOf(c) === -1) {
                break;
            }
            col = col - string_1.byteLength(c);
        }
        return col;
    }
    matchAddRanges(ranges, hlGroup, priority = 10) {
        let res = [];
        let method = this.env.isVim ? 'callTimer' : 'call';
        let arr = [];
        let splited = ranges.reduce((p, c) => {
            for (let i = c.start.line; i <= c.end.line; i++) {
                let curr = this.getline(i) || '';
                let sc = i == c.start.line ? c.start.character : 0;
                let ec = i == c.end.line ? c.end.character : curr.length;
                if (sc == ec)
                    continue;
                p.push(vscode_languageserver_protocol_1.Range.create(i, sc, i, ec));
            }
            return p;
        }, []);
        for (let range of splited) {
            let { start, end } = range;
            if (start.character == end.character)
                continue;
            let line = this.getline(start.line);
            arr.push([start.line + 1, string_1.byteIndex(line, start.character) + 1, string_1.byteLength(line.slice(start.character, end.character))]);
        }
        for (let grouped of array_1.group(arr, 8)) {
            let id = this.colorId;
            this.colorId = this.colorId + 1;
            this.nvim[method]('matchaddpos', [hlGroup, grouped, priority, id], true);
            res.push(id);
        }
        return res;
    }
    highlightRanges(ranges, hlGroup, srcId) {
        let res = [];
        if (this.env.isVim) {
            res = this.matchAddRanges(ranges, hlGroup, 10);
        }
        else {
            for (let range of ranges) {
                let { start, end } = range;
                let line = this.getline(start.line);
                // tslint:disable-next-line: no-floating-promises
                this.buffer.addHighlight({
                    hlGroup,
                    srcId,
                    line: start.line,
                    colStart: string_1.byteIndex(line, start.character),
                    colEnd: end.line - start.line == 1 && end.character == 0 ? -1 : string_1.byteIndex(line, end.character)
                });
                res.push(srcId);
            }
        }
        return res;
    }
    clearMatchIds(ids) {
        if (this.env.isVim) {
            this.nvim.call('coc#util#clearmatches', [Array.from(ids)], true);
        }
        else {
            for (let id of ids) {
                if (this.nvim.hasFunction('nvim_create_namespace')) {
                    this.buffer.clearNamespace(id);
                }
                else {
                    this.buffer.clearHighlight({ srcId: id });
                }
            }
        }
    }
    async getcwd() {
        let wid = await this.nvim.call('bufwinid', this.buffer.id);
        if (wid == -1)
            return await this.nvim.call('getcwd');
        return await this.nvim.call('getcwd', wid);
    }
    getLocalifyBonus(sp, ep) {
        let res = new Map();
        let { chars } = this;
        let startLine = Math.max(0, sp.line - 100);
        let endLine = Math.min(this.lineCount, sp.line + 100);
        let content = this.lines.slice(startLine, endLine).join('\n');
        sp = vscode_languageserver_protocol_1.Position.create(sp.line - startLine, sp.character);
        ep = vscode_languageserver_protocol_1.Position.create(ep.line - startLine, ep.character);
        let doc = vscode_languageserver_protocol_1.TextDocument.create(this.uri, this.filetype, 1, content);
        let headCount = doc.offsetAt(sp);
        let len = content.length;
        let tailCount = len - doc.offsetAt(ep);
        let start = 0;
        let preKeyword = false;
        for (let i = 0; i < headCount; i++) {
            let iskeyword = chars.isKeyword(content[i]);
            if (!preKeyword && iskeyword) {
                start = i;
            }
            else if (preKeyword && (!iskeyword || i == headCount - 1)) {
                if (i - start > 1) {
                    let str = content.slice(start, i);
                    res.set(str, i / headCount);
                }
            }
            preKeyword = iskeyword;
        }
        start = len - tailCount;
        preKeyword = false;
        for (let i = start; i < content.length; i++) {
            let iskeyword = chars.isKeyword(content[i]);
            if (!preKeyword && iskeyword) {
                start = i;
            }
            else if (preKeyword && (!iskeyword || i == len - 1)) {
                if (i - start > 1) {
                    let end = i == len - 1 ? i + 1 : i;
                    let str = content.slice(start, end);
                    let score = res.get(str) || 0;
                    res.set(str, Math.max(score, (len - i + (end - start)) / tailCount));
                }
            }
            preKeyword = iskeyword;
        }
        return res;
    }
    /**
     * Real current line
     */
    getline(line, current = true) {
        if (current)
            return this.lines[line] || '';
        let lines = this.textDocument.getText().split(/\r?\n/);
        return lines[line] || '';
    }
    getDocumentContent() {
        let content = this.lines.join('\n');
        return this.eol ? content + '\n' : content;
    }
    getVar(key, defaultValue) {
        let val = this.variables[`coc_${key}`];
        return val === undefined ? defaultValue : val;
    }
    get rootPatterns() {
        return this._rootPatterns;
    }
}
exports.default = Document;
//# sourceMappingURL=document.js.map