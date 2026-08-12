import { CompletionTriggerKind, Position, TextDocumentItem, TextDocumentSaveReason } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import * as c2p from '../../language-client/utils/codeConverter'

describe('converter', () => {

  function createDocument(): TextDocument {
    return TextDocument.create('file:///1', 'css', 1, '')
  }

  it('should convertToTextDocumentItem', () => {
    const cv = c2p.createConverter()
    let doc = createDocument()
    assert.strictEqual(cv.asTextDocumentItem(doc).uri, doc.uri)
    assert.strictEqual(TextDocumentItem.is(cv.asTextDocumentItem(doc)), true)
  })

  it('should asCloseTextDocumentParams', () => {
    const cv = c2p.createConverter()
    let doc = createDocument()
    assert.strictEqual(cv.asCloseTextDocumentParams(doc).textDocument.uri, doc.uri)
  })

  it('should asChangeTextDocumentParams', () => {
    let doc = createDocument()
    const cv = c2p.createConverter()
    assert.strictEqual(cv.asFullChangeTextDocumentParams(doc).textDocument.uri, doc.uri)
  })

  it('should asWillSaveTextDocumentParams', () => {
    const cv = c2p.createConverter()
    let res = cv.asWillSaveTextDocumentParams({ document: createDocument(), bufnr: 1, reason: TextDocumentSaveReason.Manual, waitUntil: () => {} })
    assert.notStrictEqual(res.textDocument, undefined)
    assert.notStrictEqual(res.reason, undefined)
  })

  it('should asVersionedTextDocumentIdentifier', () => {
    const cv = c2p.createConverter()
    let res = cv.asVersionedTextDocumentIdentifier(createDocument())
    assert.notStrictEqual(res.uri, undefined)
    assert.notStrictEqual(res.version, undefined)
  })

  it('should asSaveTextDocumentParams', () => {
    const cv = c2p.createConverter()
    let res = cv.asSaveTextDocumentParams(createDocument(), true)
    assert.notStrictEqual(res.textDocument.uri, undefined)
    assert.notStrictEqual(res.text, undefined)
    res = cv.asSaveTextDocumentParams(createDocument())
    assert.strictEqual(res.text, undefined)
  })

  it('should asUri', () => {
    const cv = c2p.createConverter()
    let uri = URI.file('/tmp/a')
    assert.strictEqual(cv.asUri(uri), uri.toString())
  })

  it('should asCompletionParams', () => {
    const cv = c2p.createConverter()
    let params = cv.asCompletionParams(createDocument(), Position.create(0, 0), { triggerKind: CompletionTriggerKind.Invoked })
    assert.notStrictEqual(params.textDocument, undefined)
    assert.notStrictEqual(params.position, undefined)
    assert.notStrictEqual(params.context, undefined)
  })

  it('should asTextDocumentPositionParams', () => {
    const cv = c2p.createConverter()
    let params = cv.asTextDocumentPositionParams(createDocument(), Position.create(0, 0))
    assert.notStrictEqual(params.textDocument, undefined)
    assert.notStrictEqual(params.position, undefined)
  })

  it('should asTextDocumentIdentifier', () => {
    const cv = c2p.createConverter()
    let doc = cv.asTextDocumentIdentifier(createDocument())
    assert.notStrictEqual(doc.uri, undefined)
  })

  it('should asReferenceParams', () => {
    const cv = c2p.createConverter()
    let params = cv.asReferenceParams(createDocument(), Position.create(0, 0), { includeDeclaration: false })
    assert.notStrictEqual(params.textDocument.uri, undefined)
    assert.notStrictEqual(params.position, undefined)
  })

  it('should asDocumentSymbolParams', () => {
    const cv = c2p.createConverter()
    let doc = cv.asDocumentSymbolParams(createDocument())
    assert.notStrictEqual(doc.textDocument.uri, undefined)
  })

  it('should asCodeLensParams', () => {
    const cv = c2p.createConverter()
    let doc = cv.asCodeLensParams(createDocument())
    assert.notStrictEqual(doc.textDocument.uri, undefined)
  })
})
