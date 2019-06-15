"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const vscode_languageserver_protocol_1 = require("vscode-languageserver-protocol");
const vscode_uri_1 = require("vscode-uri");
const cv = tslib_1.__importStar(require("../../language-client/utils/converter"));
describe('converter', () => {
    function createDocument() {
        return vscode_languageserver_protocol_1.TextDocument.create('file:///1', 'css', 1, '');
    }
    it('should asLanguageIds', () => {
        let selector = ['css', { language: 'javascript' }];
        expect(cv.asLanguageIds(selector)).toEqual(['css', 'javascript']);
    });
    it('should convertToTextDocumentItem', () => {
        let doc = createDocument();
        expect(cv.convertToTextDocumentItem(doc).uri).toBe(doc.uri);
        expect(vscode_languageserver_protocol_1.TextDocumentItem.is(cv.convertToTextDocumentItem(doc))).toBe(true);
    });
    it('should asCloseTextDocumentParams', () => {
        let doc = createDocument();
        expect(cv.asCloseTextDocumentParams(doc).textDocument.uri).toBe(doc.uri);
    });
    it('should asChangeTextDocumentParams', () => {
        let doc = createDocument();
        expect(cv.asChangeTextDocumentParams(doc).textDocument.uri).toBe(doc.uri);
    });
    it('should asWillSaveTextDocumentParams', () => {
        let res = cv.asWillSaveTextDocumentParams({ document: createDocument(), reason: vscode_languageserver_protocol_1.TextDocumentSaveReason.Manual });
        expect(res.textDocument).toBeDefined();
        expect(res.reason).toBeDefined();
    });
    it('should asVersionedTextDocumentIdentifier', () => {
        let res = cv.asVersionedTextDocumentIdentifier(createDocument());
        expect(res.uri).toBeDefined();
        expect(res.version).toBeDefined();
    });
    it('should asSaveTextDocumentParams', () => {
        let res = cv.asSaveTextDocumentParams(createDocument(), true);
        expect(res.textDocument.uri).toBeDefined();
        expect(res.text).toBeDefined();
    });
    it('should asUri', () => {
        let uri = vscode_uri_1.URI.file('/tmp/a');
        expect(cv.asUri(uri)).toBe(uri.toString());
    });
    it('should asCompletionParams', () => {
        let params = cv.asCompletionParams(createDocument(), vscode_languageserver_protocol_1.Position.create(0, 0), { triggerKind: vscode_languageserver_protocol_1.CompletionTriggerKind.Invoked });
        expect(params.textDocument).toBeDefined();
        expect(params.position).toBeDefined();
        expect(params.context).toBeDefined();
    });
    it('should asTextDocumentPositionParams', () => {
        let params = cv.asTextDocumentPositionParams(createDocument(), vscode_languageserver_protocol_1.Position.create(0, 0));
        expect(params.textDocument).toBeDefined();
        expect(params.position).toBeDefined();
    });
    it('should asTextDocumentIdentifier', () => {
        let doc = cv.asTextDocumentIdentifier(createDocument());
        expect(doc.uri).toBeDefined();
    });
    it('should asReferenceParams', () => {
        let params = cv.asReferenceParams(createDocument(), vscode_languageserver_protocol_1.Position.create(0, 0), { includeDeclaration: false });
        expect(params.textDocument.uri).toBeDefined();
        expect(params.position).toBeDefined();
    });
    it('should asDocumentSymbolParams', () => {
        let doc = cv.asDocumentSymbolParams(createDocument());
        expect(doc.textDocument.uri).toBeDefined();
    });
    it('should asCodeLensParams', () => {
        let doc = cv.asCodeLensParams(createDocument());
        expect(doc.textDocument.uri).toBeDefined();
    });
});
//# sourceMappingURL=converter.test.js.map