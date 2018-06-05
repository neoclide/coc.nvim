"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const document_1 = require("./model/document");
const fs_1 = require("./util/fs");
const index_1 = require("./util/index");
const vscode_1 = require("./vscode");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const logger = require('./util/logger')('workspace');
// TODO import buffers here
function toNumber(o) {
    return Number(o.toString());
}
function getChangeEvent(doc, text) {
    let orig = doc.getText();
    if (!orig.length)
        return { text };
    let start = -1;
    let end = orig.length;
    let changedText = '';
    for (let i = 0, l = orig.length; i < l; i++) {
        if (orig[i] !== text[i]) {
            start = i;
            break;
        }
    }
    if (start != -1) {
        let cl = text.length;
        let n = 1;
        for (let i = end - 1; i >= 0; i--) {
            let j = cl - n;
            if (orig[i] !== text[j]) {
                end = i + 1;
                changedText = text.slice(start, j + 1);
                break;
            }
            n++;
        }
    }
    else {
        changedText = text.slice(end);
    }
    return {
        range: {
            start: doc.positionAt(start),
            end: doc.positionAt(end),
        },
        rangeLength: end - start,
        text: changedText
    };
}
class Workspace {
    constructor() {
        this._onDidAddDocument = new vscode_1.EventEmitter();
        this._onDidRemoveDocument = new vscode_1.EventEmitter();
        this._onDidChangeDocument = new vscode_1.EventEmitter();
        this._onWillSaveDocument = new vscode_1.EventEmitter();
        this._onDidSaveDocument = new vscode_1.EventEmitter();
        this.onDidAddDocument = this._onDidAddDocument.event;
        this.onDidRemoveDocument = this._onDidRemoveDocument.event;
        this.onDidChangeDocument = this._onDidChangeDocument.event;
        this.onWillSaveDocument = this._onWillSaveDocument.event;
        this.onDidSaveDocument = this._onDidSaveDocument.event;
        this.buffers = {};
    }
    getDocument(bufnr) {
        return this.buffers[bufnr];
    }
    addBuffer(bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let buffer = yield this.getBuffer(bufnr);
            if (!buffer)
                return;
            let { buffers } = this;
            try {
                let buftype = yield buffer.getOption('buftype');
                // only care normal buffer
                if (buftype !== '')
                    return;
                let origDoc = buffers[bufnr] ? buffers[bufnr] : null;
                let version = yield buffer.changedtick;
                // not changed
                if (origDoc && origDoc.version == version) {
                    return;
                }
                let { uri, filetype, keywordOption } = origDoc || {};
                if (!origDoc) {
                    let name = yield buffer.name;
                    uri = this.getUri(name, bufnr);
                    filetype = (yield buffer.getOption('filetype'));
                    keywordOption = (yield buffer.getOption('iskeyword'));
                }
                let lines = yield buffer.lines;
                let content = lines.join('\n');
                let textDocument = vscode_languageserver_protocol_1.TextDocument.create(uri, filetype, version, content);
                if (!origDoc) {
                    buffers[bufnr] = new document_1.default(textDocument, keywordOption);
                    this._onDidAddDocument.fire(textDocument);
                }
                else {
                    origDoc.changeDocument(textDocument);
                    let evt = getChangeEvent(origDoc.textDocument, content);
                    this._onDidChangeDocument.fire({
                        textDocument,
                        contentChanges: [evt]
                    });
                }
            }
            catch (e) {
                logger.error(`buffer add error ${e.message}`);
            }
            return null;
        });
    }
    removeBuffer(bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let doc = this.buffers[bufnr];
            this.buffers[bufnr] = null;
            if (doc)
                this._onDidRemoveDocument.fire(doc.textDocument);
        });
    }
    bufferWillSave(bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let doc = this.buffers[bufnr];
            if (doc) {
                this._onWillSaveDocument.fire({
                    document: doc.textDocument,
                    reason: vscode_languageserver_protocol_1.TextDocumentSaveReason.Manual
                });
            }
        });
    }
    bufferDidSave(bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let doc = this.buffers[bufnr];
            if (doc) {
                this._onDidSaveDocument.fire(doc.textDocument);
            }
        });
    }
    // all exists documents
    get textDocuments() {
        return Object.keys(this.buffers).map(key => {
            return this.buffers[key].textDocument;
        });
    }
    refresh() {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let bufs = yield this.nvim.call('coc#util#get_buflist', []);
            this.buffers = [];
            for (let buf of bufs) {
                yield this.addBuffer(buf);
            }
            logger.info('Buffers refreshed');
        });
    }
    // words exclude bufnr and ignored files
    getWords(bufnr) {
        let words = [];
        for (let nr of Object.keys(this.buffers)) {
            if (bufnr == Number(nr))
                continue;
            let document = this.buffers[nr];
            if (document.isIgnored)
                continue;
            for (let word of document.words) {
                if (words.indexOf(word) == -1) {
                    words.push(word);
                }
            }
        }
        return words;
    }
    createDocument(fullpath, filetype) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { textDocuments } = this;
            let uri = `file://${fullpath}`;
            let document = textDocuments.find(o => o.uri == uri);
            if (document)
                return document;
            let exists = yield fs_1.statAsync(fullpath);
            if (!exists) {
                yield index_1.echoErr(this.nvim, `File ${fullpath} not exists.`);
                return null;
            }
            let content = yield fs_1.readFile(uri.replace('file://', ''), 'utf8');
            return vscode_languageserver_protocol_1.TextDocument.create(uri, filetype, 0, content);
        });
    }
    getBuffer(bufnr) {
        return tslib_1.__awaiter(this, void 0, void 0, function* () {
            let buffers = yield this.nvim.buffers;
            return buffers.find(buf => toNumber(buf.data) == bufnr);
        });
    }
    getUri(fullpath, bufnr) {
        if (!fullpath)
            return `untitled://${bufnr}`;
        if (/^\w+:\/\//.test(fullpath))
            return fullpath;
        return `file://${fullpath}`;
    }
    onDidOpenTextDocument(listener, thisArgs, disposables) {
        this.onDidAddDocument(listener, thisArgs, disposables);
    }
    onDidCloseTextDocument(listener, thisArgs, disposables) {
        this.onDidRemoveDocument(listener, thisArgs, disposables);
    }
    onDidChangeTextDocument(listener, thisArgs, disposables) {
        this.onDidChangeDocument(listener, thisArgs, disposables);
    }
    onWillSaveTextDocument(listener, thisArgs, disposables) {
        this.onWillSaveDocument(listener, thisArgs, disposables);
    }
    onDidSaveTextDocument(listener, thisArgs, disposables) {
        this.onDidSaveDocument(listener, thisArgs, disposables);
    }
}
exports.Workspace = Workspace;
exports.default = new Workspace();
//# sourceMappingURL=workspace.js.map