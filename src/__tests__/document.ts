// test code of vscode folder
import Document from '../model/document'
import {
  TextDocument,
} from 'vscode-languageserver-protocol'

describe('document model', () => {

  function createDocument(content):Document {
    let uri = 'file:///tmp/tmp.ts'
    let textDocument = TextDocument.create(uri, 'typescript', 1, content)
    return new Document(1, textDocument, '@')
  }

  test('create document', async () => {
    let doc = createDocument('abc')
    expect(doc.isIgnored).toBeFalsy
  })

  test('word at position #1', async () => {
    let doc = createDocument('a')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:0
    })
    expect(range.end.character - range.start.character).toBe(1)
  })

  test('word at position #2', async () => {
    let doc = createDocument('a')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:1
    })
    expect(range.end.character - range.start.character).toBe(1)
  })

  test('word at position #3', async () => {
    let doc = createDocument('a b')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:0
    })
    expect(range.end.character - range.start.character).toBe(1)
  })

  test('word at position #4', async () => {
    let doc = createDocument('a b')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:1
    })
    expect(range.end.character - range.start.character).toBe(1)
  })

  test('word at position #5', async () => {
    let doc = createDocument('a b')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:2
    })
    expect(range.end.character - range.start.character).toBe(1)
  })

  test('word at position #6', async () => {
    let doc = createDocument('a b')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:3
    })
    expect(range.end.character - range.start.character).toBe(1)
  })

  test('word at position #7', async () => {
    let doc = createDocument('ab. b')
    let range = doc.getWordRangeAtPosition({
      line: 0,
      character:3
    })
    expect(range.end.character - range.start.character).toBe(0)
  })
})
