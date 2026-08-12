import DiagnosticCollection from '../../diagnostic/collection'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Range } from 'vscode-languageserver-types'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

function createDiagnostic(msg: string, range?: Range): Diagnostic {
  range = range ? range : Range.create(0, 0, 0, 1)
  return Diagnostic.create(range, msg)
}

describe('diagnostic collection', () => {

  it('should create collection', () => {
    let collection = new DiagnosticCollection('test')
    assert.strictEqual(collection.name, 'test')
    collection.dispose()
  })

  it('should set diagnostic with uri', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    collection.set(uri, [diagnostic])
    assert.strictEqual(collection.get(uri).length, 1)
    collection.set(uri, [])
    assert.strictEqual(collection.get(uri).length, 0)
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
    assert.strictEqual(arr.length, 2)
    assert.strictEqual(arr[0].severity, DiagnosticSeverity.Hint)
    assert.strictEqual(arr[1].severity, DiagnosticSeverity.Hint)
  })

  it('should clear diagnostics with null as diagnostics', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    collection.set(uri, [diagnostic])
    assert.strictEqual(collection.get(uri).length, 1)
    collection.set(uri, null)
    assert.strictEqual(collection.get(uri).length, 0)
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
    assert.strictEqual(collection.get(uri).length, 0)
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
    assert.strictEqual(collection.get(uri).length, 2)
    assert.strictEqual(collection.get(other).length, 1)
  })

  it('should delete diagnostics for uri', () => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    collection.set(uri, [diagnostic])
    collection.delete(uri)
    assert.strictEqual(collection.get(uri).length, 0)
  })

  it('should clear all diagnostics', t => {
    let collection = new DiagnosticCollection('test')
    let diagnostic = createDiagnostic('error')
    let uri = 'file:///1'
    let fn = t.mock.fn()
    collection.set(uri, [diagnostic])
    collection.onDidDiagnosticsChange(fn)
    collection.clear()
    assert.strictEqual(collection.get(uri).length, 0)
    assert.strictEqual(fn.mock.callCount(), 1)
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
    assert.deepStrictEqual(arr, [uri, other])
  })
})
