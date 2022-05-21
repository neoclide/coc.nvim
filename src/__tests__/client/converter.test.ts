import { CompletionList, CompletionTriggerKind, InsertReplaceEdit, InsertTextFormat, InsertTextMode, Position, Range, TextDocumentItem, TextDocumentSaveReason } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import * as assert from 'assert'
import * as cv from '../../language-client/utils/converter'
import { SnippetString } from '../../snippets/string'

describe('converter', () => {

  function createDocument(): TextDocument {
    return TextDocument.create('file:///1', 'css', 1, '')
  }

  it('should convertToTextDocumentItem', () => {
    let doc = createDocument()
    expect(cv.convertToTextDocumentItem(doc).uri).toBe(doc.uri)
    expect(TextDocumentItem.is(cv.convertToTextDocumentItem(doc))).toBe(true)
  })

  it('should asCloseTextDocumentParams', () => {
    let doc = createDocument()
    expect(cv.asCloseTextDocumentParams(doc).textDocument.uri).toBe(doc.uri)
  })

  it('should asChangeTextDocumentParams', () => {
    let doc = createDocument()
    expect(cv.asChangeTextDocumentParams(doc).textDocument.uri).toBe(doc.uri)
  })

  it('should asWillSaveTextDocumentParams', () => {
    let res = cv.asWillSaveTextDocumentParams({ document: createDocument(), reason: TextDocumentSaveReason.Manual, waitUntil: () => {} })
    expect(res.textDocument).toBeDefined()
    expect(res.reason).toBeDefined()
  })

  it('should asVersionedTextDocumentIdentifier', () => {
    let res = cv.asVersionedTextDocumentIdentifier(createDocument())
    expect(res.uri).toBeDefined()
    expect(res.version).toBeDefined()
  })

  it('should asSaveTextDocumentParams', () => {
    let res = cv.asSaveTextDocumentParams(createDocument(), true)
    expect(res.textDocument.uri).toBeDefined()
    expect(res.text).toBeDefined()
    res = cv.asSaveTextDocumentParams(createDocument(), false)
    expect(res.text).toBeUndefined()
  })

  it('should asUri', () => {
    let uri = URI.file('/tmp/a')
    expect(cv.asUri(uri)).toBe(uri.toString())
  })

  it('should asCompletionParams', () => {
    let params = cv.asCompletionParams(createDocument(), Position.create(0, 0), { triggerKind: CompletionTriggerKind.Invoked })
    expect(params.textDocument).toBeDefined()
    expect(params.position).toBeDefined()
    expect(params.context).toBeDefined()
  })

  it('should asTextDocumentPositionParams', () => {
    let params = cv.asTextDocumentPositionParams(createDocument(), Position.create(0, 0))
    expect(params.textDocument).toBeDefined()
    expect(params.position).toBeDefined()
  })

  it('should asTextDocumentIdentifier', () => {
    let doc = cv.asTextDocumentIdentifier(createDocument())
    expect(doc.uri).toBeDefined()
  })

  it('should asReferenceParams', () => {
    let params = cv.asReferenceParams(createDocument(), Position.create(0, 0), { includeDeclaration: false })
    expect(params.textDocument.uri).toBeDefined()
    expect(params.position).toBeDefined()
  })

  it('should asDocumentSymbolParams', () => {
    let doc = cv.asDocumentSymbolParams(createDocument())
    expect(doc.textDocument.uri).toBeDefined()
  })

  it('should asCodeLensParams', () => {
    let doc = cv.asCodeLensParams(createDocument())
    expect(doc.textDocument.uri).toBeDefined()
  })

  it('Completion Result - edit range', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults:  { editRange: Range.create(1,2,3,4) },
      items: [{ label: 'item', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
  })

  it('Completion Result - edit range with textEditText', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults:  { editRange: Range.create(1,2,3,4) },
      items: [{ label: 'item', textEditText: 'text', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
    assert.strictEqual(result.items[0].insertText, 'text')
  })

  it('Completion Result - insert / replace range', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults: { editRange: { insert: Range.create(1,1,1,1), replace: Range.create(1,2,3,4) } },
      items: [{ label: 'item', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
    assert.strictEqual(InsertReplaceEdit.is(result.items[0].textEdit), true)
  })

  it('Completion Result - insert / replace range with textEditText', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults: { editRange: { insert: Range.create(1,1,1,1), replace: Range.create(1,2,3,4) } },
      items: [{ label: 'item', textEditText: 'text', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
    assert.strictEqual(result.items[0].insertText, 'text')
  })

  it('Completion Result - commit characters', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults: { commitCharacters: ['.', ',']},
      items: [{ label: 'item', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
    const commitCharacters = result.items[0].commitCharacters!
    assert.strictEqual(commitCharacters?.length, 2)
    assert.strictEqual(commitCharacters[0], '.')
    assert.strictEqual(commitCharacters[1], ',')
  })

  it('Completion Result - insert text mode', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults: { insertTextMode: InsertTextMode.asIs },
      items: [{ label: 'item', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
    assert.strictEqual(result.items[0].insertTextMode, InsertTextMode.asIs)
  })

  it('Completion Result - insert text format', async () => {
    const completionResult: CompletionList = {
      isIncomplete: true,
      itemDefaults: { insertTextFormat: InsertTextFormat.Snippet },
      items: [{ label: 'item', insertText: '${value}', data: 'data' }]
    }
    const result = cv.asCompletionList(completionResult)
    assert.strictEqual(result.isIncomplete, completionResult.isIncomplete)
    assert.strictEqual(result.items.length, 1)
    assert.strictEqual(result.items[0].label, 'item')
    assert.strictEqual(result.items[0].insertTextFormat , InsertTextFormat.Snippet)
  })
})
