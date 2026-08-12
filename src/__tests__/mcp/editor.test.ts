'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DocumentSymbol, Position, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { createEditorTools, getVisualSelection, innermostSymbol, lineText } from '../../mcp/tools/editor'
import { lspQueryCache } from '../../mcp/tools/lsp'
import helper from '../helper'
import { CancellationToken } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'

let tmpdir: string
let file: string
let uri: string
const token = CancellationToken.None

beforeAll(async () => {
  await helper.setup()
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-editor-'))
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  file = path.join(tmpdir, 'sample.ts')
  fs.writeFileSync(file, 'function foo() {\n  return 42\n}\n')
  uri = URI.file(file).toString()
  await helper.nvim.command(`edit ${file}`)
  await helper.nvim.command('setfiletype typescript')
  await helper.waitValue(() => !!workspace.getDocument(uri), true)
  await helper.waitValue(() => workspace.getDocument(uri)!.languageId, 'typescript')
})

afterAll(async () => {
  await helper.shutdown()
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function tool() {
  return createEditorTools().find(t => t.name === 'editor/state')!
}

describe('mcp editor tools', () => {
  it('exports editor state helpers for edge-case testing', async (t) => {
    let doc: any = {
      lineCount: 2,
      getLines: (start: number) => start === 0 ? ['alpha'] : [''],
      textDocument: { getText: () => 'selection' }
    }
    assert.strictEqual(lineText(doc, -1), '')
    assert.strictEqual(lineText(doc, 2), '')
    assert.strictEqual(lineText(doc, 0), 'alpha')
    assert.strictEqual(lineText(doc, 1), '')
    assert.strictEqual(innermostSymbol(null, Position.create(0, 0)), null)
    let outside = DocumentSymbol.create('outside', undefined, SymbolKind.File, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1))
    assert.strictEqual(innermostSymbol([outside], Position.create(0, 0)), null)

    let evalMock = t.mock.fn<(...args: any[]) => Promise<any>>()
    evalMock.mock.mockImplementationOnce(() => Promise.resolve([1, 1, 1, 1, true]), 0)
    evalMock.mock.mockImplementationOnce(() => Promise.resolve(['', '']), 1)
    let nvim: any = {
      call: t.mock.fn(() => Promise.resolve('v')),
      eval: evalMock
    }
    assert.deepStrictEqual((await getVisualSelection(doc, nvim))!.range, Range.create(0, 0, 0, 1))
  })

  it('editor/state returns active editor state', async () => {
    await helper.nvim.call('cursor', [2, 3])
    let result = await tool().handler({}, { token })
    assert.ok(!(result.isError))
    let s = result.structuredContent
    assert.strictEqual(s.workspace, workspace.root)
    assert.strictEqual(s.document.uri, uri)
    assert.strictEqual(s.document.language, 'typescript')
    assert.ok((s.document.version) > (0))
    assert.deepStrictEqual(s.cursor, { line: 1, character: 2 })
    assert.deepStrictEqual(s.surroundingCode, {
      before: 'function foo() {',
      current: '  return 42',
      after: '}'
    })
    assert.strictEqual(s.selection, null)
    assert.ok((s.visibleRange.start) <= (1))
    assert.ok((s.visibleRange.end) >= (1))
    assert.ok((s.visibleRange.lines).includes('  return 42'))
    assert.strictEqual(Array.isArray(s.diagnostics), true)
    assert.strictEqual(s.symbol, null)
  })

  it('editor/state returns visual selection', async () => {
    await helper.nvim.call('cursor', [2, 1])
    await helper.nvim.input('v$')
    let result = await tool().handler({}, { token })
    await helper.nvim.input('<esc>')
    let s = result.structuredContent
    assert.notStrictEqual(s.selection, null)
    assert.strictEqual(s.selection.text, '  return 42')
    assert.deepStrictEqual(s.selection.range.start, { line: 1, character: 0 })
    assert.deepStrictEqual(s.selection.range.end, { line: 1, character: '  return 42'.length })
  })

  it('editor/state returns linewise visual selection', async () => {
    await helper.nvim.call('cursor', [2, 1])
    await helper.nvim.input('Vj')
    let result = await tool().handler({}, { token })
    await helper.nvim.input('<esc>')
    let s = result.structuredContent
    assert.notStrictEqual(s.selection, null)
    assert.strictEqual(s.selection.text, '  return 42\n}\n')
    assert.deepStrictEqual(s.selection.range.start, { line: 1, character: 0 })
    assert.deepStrictEqual(s.selection.range.end, { line: 3, character: 0 })
  })

  it('editor/state normalizes a backwards visual selection', async () => {
    await helper.nvim.call('cursor', [2, 8])
    await helper.nvim.input('v0')
    let result = await tool().handler({}, { token })
    await helper.nvim.input('<esc>')
    let selection = result.structuredContent.selection
    assert.strictEqual(selection.text, '  return')
    assert.deepStrictEqual(selection.range.start, { line: 1, character: 0 })
    assert.deepStrictEqual(selection.range.end, { line: 1, character: 8 })
  })

  it('editor/state returns the innermost symbol at the cursor', async () => {
    let child = DocumentSymbol.create('inner', undefined, SymbolKind.Function, Range.create(1, 0, 1, 11), Range.create(1, 2, 1, 8))
    let parent = DocumentSymbol.create('outer', undefined, SymbolKind.Module, Range.create(0, 0, 2, 1), Range.create(0, 0, 0, 8))
    parent.children = [child]
    let disposable = languages.registerDocumentSymbolProvider([{ language: 'typescript' }], {
      provideDocumentSymbols: () => [parent]
    })
    lspQueryCache.clear()
    try {
      await helper.nvim.call('cursor', [2, 3])
      let result = await tool().handler({}, { token })
      assert.deepStrictEqual(result.structuredContent.symbol, { name: 'inner', kind: 'function' })
    } finally {
      disposable.dispose()
      lspQueryCache.clear()
    }
  })

  it('editor/state returns an error without an active editor', async (t) => {
    let spy = t.mock.getter(window, 'activeTextEditor', () => (undefined))
    try {
      let result = await tool().handler({}, { token })
      assert.strictEqual(result.isError, true)
      assert.strictEqual(result.content[0].text, 'No active editor')
    } finally {
      spy.mock.restore()
    }
  })

  it('editor/state returns null selection outside visual mode', async () => {
    await helper.nvim.input('v<esc>')
    let result = await tool().handler({}, { token })
    assert.strictEqual(result.structuredContent.selection, null)
  })
})
