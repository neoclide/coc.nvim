"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const collection_1 = tslib_1.__importDefault(require("../../diagnostic/collection"));
const vscode_languageserver_types_1 = require("vscode-languageserver-types");
function createDiagnostic(msg, range) {
    range = range ? range : vscode_languageserver_types_1.Range.create(0, 0, 0, 1);
    return vscode_languageserver_types_1.Diagnostic.create(range, msg);
}
describe('diagnostic collection', () => {
    it('should create collection', () => {
        let collection = new collection_1.default('test');
        expect(collection.name).toBe('test');
    });
    it('should set diagnostic with uri', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let uri = 'file:///1';
        collection.set(uri, [diagnostic]);
        expect(collection.get(uri).length).toBe(1);
        collection.set(uri, []);
        expect(collection.get(uri).length).toBe(0);
    });
    it('should clear diagnostics with null as diagnostics', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let uri = 'file:///1';
        collection.set(uri, [diagnostic]);
        expect(collection.get(uri).length).toBe(1);
        collection.set(uri, null);
        expect(collection.get(uri).length).toBe(0);
    });
    it('should clear diagnostics with undefined as diagnostics in entries', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let entries = [
            ['file:1', [diagnostic]],
            ['file:1', undefined]
        ];
        let uri = 'file:///1';
        collection.set(entries);
        expect(collection.get(uri).length).toBe(0);
    });
    it('should set diagnostics with entries', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let uri = 'file:///1';
        let other = 'file:///2';
        let entries = [
            [uri, [diagnostic]],
            [other, [diagnostic]],
            [uri, [createDiagnostic('other')]]
        ];
        collection.set(entries);
        expect(collection.get(uri).length).toBe(2);
        expect(collection.get(other).length).toBe(1);
    });
    it('should delete diagnostics for uri', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let uri = 'file:///1';
        collection.set(uri, [diagnostic]);
        collection.delete(uri);
        expect(collection.get(uri).length).toBe(0);
    });
    it('should clear all diagnostics', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let uri = 'file:///1';
        collection.set(uri, [diagnostic]);
        collection.clear();
        expect(collection.get(uri).length).toBe(0);
    });
    it('should call for every uri with diagnostics', () => {
        let collection = new collection_1.default('test');
        let diagnostic = createDiagnostic('error');
        let uri = 'file:///1';
        let other = 'file:///2';
        let entries = [
            [uri, [diagnostic]],
            [other, [diagnostic]],
            [uri, [createDiagnostic('other')]]
        ];
        collection.set(entries);
        let arr = [];
        collection.forEach(uri => {
            arr.push(uri);
        });
        expect(arr).toEqual([uri, other]);
    });
});
//# sourceMappingURL=diagnosticCollection.test.js.map