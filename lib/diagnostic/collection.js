"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const position_1 = require("../util/position");
const logger = require('../util/logger')('diagnostic-collection');
class Collection {
    constructor(owner) {
        this.diagnosticsMap = new Map();
        this._onDispose = new vscode_languageserver_protocol_1.Emitter();
        this._onDidDiagnosticsChange = new vscode_languageserver_protocol_1.Emitter();
        this._onDidDiagnosticsClear = new vscode_languageserver_protocol_1.Emitter();
        this.onDispose = this._onDispose.event;
        this.onDidDiagnosticsChange = this._onDidDiagnosticsChange.event;
        this.onDidDiagnosticsClear = this._onDidDiagnosticsClear.event;
        this.name = owner;
    }
    set(entries, diagnostics) {
        if (Array.isArray(entries)) {
            let map = new Map();
            for (let item of entries) {
                let [file, diagnostics] = item;
                let exists = map.get(file) || [];
                if (diagnostics != null) {
                    for (let diagnostic of diagnostics) {
                        exists.push(diagnostic);
                    }
                }
                else {
                    exists = [];
                }
                map.set(file, exists);
            }
            for (let key of map.keys()) {
                this.set(key, map.get(key));
            }
            return;
        }
        let uri = entries;
        uri = vscode_uri_1.URI.parse(uri).toString();
        if (diagnostics) {
            diagnostics.forEach(o => {
                if (position_1.emptyRange(o.range)) {
                    o.range.end = {
                        line: o.range.end.line,
                        character: o.range.end.character + 1
                    };
                }
                o.source = o.source || this.name;
            });
        }
        this.diagnosticsMap.set(uri, diagnostics || []);
        this._onDidDiagnosticsChange.fire(uri);
        return;
    }
    delete(uri) {
        this.diagnosticsMap.delete(uri);
        this._onDidDiagnosticsChange.fire(uri);
    }
    clear() {
        let uris = Array.from(this.diagnosticsMap.keys());
        this.diagnosticsMap.clear();
        this._onDidDiagnosticsClear.fire(uris);
    }
    forEach(callback, thisArg) {
        for (let uri of this.diagnosticsMap.keys()) {
            let diagnostics = this.diagnosticsMap.get(uri);
            callback.call(thisArg, uri, diagnostics, this);
        }
    }
    get(uri) {
        let arr = this.diagnosticsMap.get(uri);
        return arr == null ? [] : arr;
    }
    has(uri) {
        return this.diagnosticsMap.has(uri);
    }
    dispose() {
        this.clear();
        this._onDispose.fire(void 0);
        this._onDispose.dispose();
        this._onDidDiagnosticsClear.dispose();
        this._onDidDiagnosticsChange.dispose();
    }
}
exports.default = Collection;
//# sourceMappingURL=collection.js.map