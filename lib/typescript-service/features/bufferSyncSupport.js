"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const workspace_1 = require("../../workspace");
const vscode_1 = require("../../vscode");
const async_1 = require("../utils/async");
const languageModeIds = require("../utils/languageModeIds");
function mode2ScriptKind(mode) {
    switch (mode) {
        case languageModeIds.typescript:
            return 'TS';
        case languageModeIds.typescriptreact:
            return 'TSX';
        case languageModeIds.javascript:
            return 'JS';
        case languageModeIds.javascriptreact:
            return 'JSX';
    }
    return undefined;
}
class SyncedBuffer {
    constructor(document, filepath, diagnosticRequestor, client) {
        this.document = document;
        this.filepath = filepath;
        this.diagnosticRequestor = diagnosticRequestor;
        this.client = client;
    }
    open() {
        const args = {
            file: this.filepath,
            fileContent: this.document.getText()
        };
        if (this.client.apiVersion.has203Features()) {
            const scriptKind = mode2ScriptKind(this.document.languageId);
            if (scriptKind) {
                args.scriptKindName = scriptKind;
            }
        }
        if (this.client.apiVersion.has240Features()) {
            // we don't support bundled extensitions
        }
        this.client.execute('open', args, false); // tslint:disable-line
    }
    get lineCount() {
        return this.document.lineCount;
    }
    close() {
        const args = {
            file: this.filepath
        };
        this.client.execute('close', args, false); // tslint:disable-line
    }
    // TODO send ChangeEvent here
    onContentChanged(events) {
        let uri = vscode_1.Uri.file(this.document.uri);
        const filePath = this.client.normalizePath(uri);
        if (!filePath) {
            return;
        }
        for (const { range, text } of events) {
            const args = {
                file: filePath,
                line: range.start.line + 1,
                offset: range.start.character + 1,
                endLine: range.end.line + 1,
                endOffset: range.end.character + 1,
                insertString: text
            };
            this.client.execute('change', args, false); // tslint:disable-line
        }
        this.diagnosticRequestor.requestDiagnostic(uri);
    }
}
class SyncedBufferMap {
    constructor(_normalizePath) {
        this._normalizePath = _normalizePath;
        this._map = new Map();
    }
    has(resource) {
        const file = this._normalizePath(resource);
        return !!file && this._map.has(file);
    }
    get(resource) {
        const file = this._normalizePath(resource);
        return file ? this._map.get(file) : undefined;
    }
    set(resource, buffer) {
        const file = this._normalizePath(resource);
        if (file) {
            this._map.set(file, buffer);
        }
    }
    delete(resource) {
        const file = this._normalizePath(resource);
        if (file) {
            this._map.delete(file);
        }
    }
    get allBuffers() {
        return this._map.values();
    }
    get allResources() {
        return this._map.keys();
    }
}
class BufferSyncSupport {
    constructor(client, modeIds, diagnostics, validate) {
        this.disposables = [];
        this.pendingDiagnostics = new Map();
        this.client = client;
        this.modeIds = new Set(modeIds);
        this.diagnostics = diagnostics;
        this._validate = validate;
        this.diagnosticDelayer = new async_1.Delayer(300);
        this.syncedBuffers = new SyncedBufferMap(path => this.client.normalizePath(path));
    }
    listen() {
        workspace_1.default.onDidOpenTextDocument(this.onDidOpenTextDocument, this, this.disposables);
        workspace_1.default.onDidCloseTextDocument(this.onDidCloseTextDocument, this, this.disposables);
        workspace_1.default.onDidChangeTextDocument(this.onDidChangeTextDocument, this, this.disposables);
        workspace_1.default.textDocuments.forEach(this.onDidOpenTextDocument, this);
    }
    set validate(value) {
        this._validate = value;
    }
    handles(resource) {
        return this.syncedBuffers.has(resource);
    }
    reOpenDocuments() {
        for (const buffer of this.syncedBuffers.allBuffers) {
            buffer.open();
        }
    }
    dispose() {
        vscode_1.disposeAll(this.disposables);
    }
    onDidOpenTextDocument(document) {
        if (!this.modeIds.has(document.languageId)) {
            return;
        }
        const resource = vscode_1.Uri.file(document.uri);
        const filepath = this.client.normalizePath(resource);
        if (!filepath) {
            return;
        }
        if (this.syncedBuffers.has(resource)) {
            return;
        }
        const syncedBuffer = new SyncedBuffer(document, filepath, this, this.client);
        this.syncedBuffers.set(resource, syncedBuffer);
        syncedBuffer.open();
        this.requestDiagnostic(resource);
    }
    onDidCloseTextDocument(document) {
        const resource = vscode_1.Uri.file(document.uri);
        const syncedBuffer = this.syncedBuffers.get(resource);
        if (!syncedBuffer) {
            return;
        }
        this.diagnostics.delete(resource);
        this.syncedBuffers.delete(resource);
        syncedBuffer.close();
        if (!fs.existsSync(resource.fsPath)) {
            this.requestAllDiagnostics();
        }
    }
    onDidChangeTextDocument(e) {
        const uri = vscode_1.Uri.file(e.textDocument.uri);
        const syncedBuffer = this.syncedBuffers.get(uri);
        if (syncedBuffer) {
            syncedBuffer.onContentChanged(e.contentChanges);
        }
    }
    requestAllDiagnostics() {
        if (!this._validate) {
            return;
        }
        for (const filePath of this.syncedBuffers.allResources) {
            this.pendingDiagnostics.set(filePath, Date.now());
        }
        this.diagnosticDelayer.trigger(() => {
            this.sendPendingDiagnostics();
        }, 200);
    }
    requestDiagnostic(resource) {
        if (!this._validate) {
            return;
        }
        const file = this.client.normalizePath(resource);
        if (!file) {
            return;
        }
        this.pendingDiagnostics.set(file, Date.now());
        const buffer = this.syncedBuffers.get(resource);
        let delay = 300;
        if (buffer) {
            const lineCount = buffer.lineCount;
            delay = Math.min(Math.max(Math.ceil(lineCount / 20), 300), 800);
        }
        this.diagnosticDelayer.trigger(() => {
            this.sendPendingDiagnostics();
        }, delay); // tslint:disable-line
    }
    hasPendingDiagnostics(resource) {
        const file = this.client.normalizePath(resource);
        return !file || this.pendingDiagnostics.has(file);
    }
    sendPendingDiagnostics() {
        if (!this._validate) {
            return;
        }
        const files = Array.from(this.pendingDiagnostics.entries())
            .sort((a, b) => a[1] - b[1])
            .map(entry => entry[0]);
        // Add all open TS buffers to the geterr request. They might be visible
        for (const file of this.syncedBuffers.allResources) {
            if (!this.pendingDiagnostics.get(file)) {
                files.push(file);
            }
        }
        if (files.length) {
            const args = {
                delay: 0,
                files
            };
            this.client.execute('geterr', args, false); // tslint:disable-line
        }
        this.pendingDiagnostics.clear();
    }
}
exports.default = BufferSyncSupport;
//# sourceMappingURL=bufferSyncSupport.js.map