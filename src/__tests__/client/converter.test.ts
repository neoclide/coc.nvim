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
    expect(cv.asTextDocumentItem(doc).uri).toBe(doc.uri)
    expect(TextDocumentItem.is(cv.asTextDocumentItem(doc))).toBe(true)
  })

  it('should asCloseTextDocumentParams', () => {
    const cv = c2p.createConverter()
    let doc = createDocument()
    expect(cv.asCloseTextDocumentParams(doc).textDocument.uri).toBe(doc.uri)
  })

  it('should asChangeTextDocumentParams', () => {
    let doc = createDocument()
    const cv = c2p.createConverter()
    expect(cv.asFullChangeTextDocumentParams(doc).textDocument.uri).toBe(doc.uri)
  })

  it('should asWillSaveTextDocumentParams', () => {
    const cv = c2p.createConverter()
    let res = cv.asWillSaveTextDocumentParams({ document: createDocument(), bufnr: 1, reason: TextDocumentSaveReason.Manual, waitUntil: () => {} })
    expect(res.textDocument).toBeDefined()
    expect(res.reason).toBeDefined()
  })

  it('should asVersionedTextDocumentIdentifier', () => {
    const cv = c2p.createConverter()
    let res = cv.asVersionedTextDocumentIdentifier(createDocument())
    expect(res.uri).toBeDefined()
    expect(res.version).toBeDefined()
  })

  it('should asSaveTextDocumentParams', () => {
    const cv = c2p.createConverter()
    let res = cv.asSaveTextDocumentParams(createDocument(), true)
    expect(res.textDocument.uri).toBeDefined()
    expect(res.text).toBeDefined()
    res = cv.asSaveTextDocumentParams(createDocument())
    expect(res.text).toBeUndefined()
  })

  it('should asUri', () => {
    const cv = c2p.createConverter()
    let uri = URI.file('/tmp/a')
    expect(cv.asUri(uri)).toBe(uri.toString())
  })

  it('should asCompletionParams', () => {
    const cv = c2p.createConverter()
    let params = cv.asCompletionParams(createDocument(), Position.create(0, 0), { triggerKind: CompletionTriggerKind.Invoked })
    expect(params.textDocument).toBeDefined()
    expect(params.position).toBeDefined()
    expect(params.context).toBeDefined()
  })

  it('should asTextDocumentPositionParams', () => {
    const cv = c2p.createConverter()
    let params = cv.asTextDocumentPositionParams(createDocument(), Position.create(0, 0))
    expect(params.textDocument).toBeDefined()
    expect(params.position).toBeDefined()
  })

  it('should asTextDocumentIdentifier', () => {
    const cv = c2p.createConverter()
    let doc = cv.asTextDocumentIdentifier(createDocument())
    expect(doc.uri).toBeDefined()
  })

  it('should asReferenceParams', () => {
    const cv = c2p.createConverter()
    let params = cv.asReferenceParams(createDocument(), Position.create(0, 0), { includeDeclaration: false })
    expect(params.textDocument.uri).toBeDefined()
    expect(params.position).toBeDefined()
  })

  it('should asDocumentSymbolParams', () => {
    const cv = c2p.createConverter()
    let doc = cv.asDocumentSymbolParams(createDocument())
    expect(doc.textDocument.uri).toBeDefined()
  })

  it('should asCodeLensParams', () => {
    const cv = c2p.createConverter()
    let doc = cv.asCodeLensParams(createDocument())
    expect(doc.textDocument.uri).toBeDefined()
  })
})
