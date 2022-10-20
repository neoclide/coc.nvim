import DiagnosticCollection from '../../diagnostic/collection'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Range } from 'vscode-languageserver-types'

function createDiagnostic(msg: string, range?: Range): Diagnostic {
  range = range ? range : Range.create(0, 0, 0, 1)
  return Diagnostic.create(range, msg)
}

describe('diagnostic collection', () => {

  it('should create collection', () => {
    let collection = new DiagnosticCollection('test')
    expect(collection.name).toBe('test')
    collection.dispose()
  })

  it('should set diagnostic with uri', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    collection.set(uri, [diagnostic])
    expect(collection.get(uri).length).toBe(1)
    collection.set(uri, [])
    expect(collection.get(uri).length).toBe(0)
  })

  it('should set severity for hint tags', async () => {
    let collection = new DiagnosticCollection('test')
    let diagnostics = [{
      range: null,
      message: undefined,
      tags: [DiagnosticTag.Deprecated]
    }, {
      range: Range.create(0, 0, 0, 1),
      message: undefined,
      tags: [DiagnosticTag.Unnecessary]
    }]
    let uri = 'file:///1'
    collection.set(uri, diagnostics)
    let arr = collection.get(uri)
    expect(arr.length).toBe(2)
    expect(arr[0].severity).toBe(DiagnosticSeverity.Hint)
    expect(arr[1].severity).toBe(DiagnosticSeverity.Hint)
  })

  it('should clear diagnostics with null as diagnostics', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    collection.set(uri, [diagnostic])
    expect(collection.get(uri).length).toBe(1)
    collection.set(uri, null)
    expect(collection.get(uri).length).toBe(0)
  })

  it('should clear diagnostics with undefined as diagnostics in entries', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let entries: [string, Diagnostic[] | null][] = [
      ['file:1', [diagnostic]],
      ['file:1', undefined]
    ]
    let uri = 'file:///1'
    collection.set(entries)
    expect(collection.get(uri).length).toBe(0)
  })

  it('should set diagnostics with entries', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    let other = 'file:///2'
    let entries: [string, Diagnostic[]][] = [
      [uri, [diagnostic]],
      [other, [diagnostic]],
      [uri, [createDiagnostic('other')]]
    ]
    collection.set(entries)
    expect(collection.get(uri).length).toBe(2)
    expect(collection.get(other).length).toBe(1)
  })

  it('should delete diagnostics for uri', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    collection.set(uri, [diagnostic])
    collection.delete(uri)
    expect(collection.get(uri).length).toBe(0)
  })

  it('should clear all diagnostics', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    let fn = jest.fn()
    collection.set(uri, [diagnostic])
    collection.onDidDiagnosticsChange(fn)
    collection.clear()
    expect(collection.get(uri).length).toBe(0)
    expect(fn).toBeCalledTimes(1)
  })

  it('should call for every uri with diagnostics', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    let other = 'file:///2'
    let entries: [string, Diagnostic[]][] = [
      [uri, [diagnostic]],
      [other, [diagnostic]],
      [uri, [createDiagnostic('other')]]
    ]
    collection.set(entries)
    let arr: string[] = []
    collection.forEach(uri => {
      arr.push(uri)
    })
    expect(arr).toEqual([uri, other])
  })
})
