import * as shared from '../sharedUtil'
'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DocumentSymbol, Position, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { createEditorTools, getVisualSelection, innermostSymbol, lineText } from '../../mcp/tools/editor'
import { lspQueryCache } from '../../mcp/tools/lsp'
import { CancellationToken } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'


let tmpdir: string
let file: string
let uri: string
const token = CancellationToken.None

before(async () => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-editor-'))
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  file = path.join(tmpdir, 'sample.ts')
  uri = URI.file(file).toString()
})

beforeEach(async () => {
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  fs.writeFileSync(file, 'function foo() {\n  return 42\n}\n')
  await workspace.nvim.command(`edit ${file}`)
  await workspace.nvim.command('setfiletype typescript')
  await shared.waitValue(() => !!workspace.getDocument(uri), true)
  await shared.waitValue(() => workspace.getDocument(uri)!.languageId, 'typescript')
})

after(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function tool() {
  return createEditorTools().find(t => t.name === 'editor/state')!
}

describe('mcp editor tools', () => {
  it('exports editor state helpers for edge-case testing', async t => {
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

    let nvim: any = {
      call: t.mock.fn(async () => 'v'),
      eval: (() => {
        let calls = 0
        return t.mock.fn(async () => {
          calls++
          if (calls === 1) return [1, 1, 1, 1, true]
          return ['', '']
        })
      })()
    }
    assert.deepStrictEqual((await getVisualSelection(doc, nvim))!.range, Range.create(0, 0, 0, 1))
  })

  it('editor/state returns active editor state', async t => {
    await workspace.nvim.call('cursor', [2, 3])
    let result = await tool().handler({}, { token })
    assert.ok(!result.isError)
    let s = result.structuredContent
    assert.strictEqual(s.workspace, workspace.root)
    assert.strictEqual(s.document.uri, uri)
    assert.strictEqual(s.document.language, 'typescript')
    assert.ok(s.document.version > 0)
    assert.deepStrictEqual(s.cursor, { line: 1, character: 2 })
    assert.deepStrictEqual(s.surroundingCode, {
      before: 'function foo() {',
      current: '  return 42',
      after: '}'
    })
    assert.strictEqual(s.selection, null)
    assert.ok(s.visibleRange.start <= 1)
    assert.ok(s.visibleRange.end >= 1)
    assert.ok(s.visibleRange.lines.includes('  return 42'))
    assert.strictEqual(Array.isArray(s.diagnostics), true)
    assert.strictEqual(s.symbol, null)
  })

  it('editor/state returns visual selection', async t => {
    await workspace.nvim.call('cursor', [2, 1])
    await workspace.nvim.input('v$')
    let result = await tool().handler({}, { token })
    await workspace.nvim.input('<esc>')
    let s = result.structuredContent
    assert.notStrictEqual(s.selection, null)
    assert.strictEqual(s.selection.text, '  return 42')
    assert.deepStrictEqual(s.selection.range.start, { line: 1, character: 0 })
    assert.deepStrictEqual(s.selection.range.end, { line: 1, character: '  return 42'.length })
  })

  it('editor/state returns linewise visual selection', async t => {
    await workspace.nvim.call('cursor', [2, 1])
    await workspace.nvim.input('Vj')
    let result = await tool().handler({}, { token })
    await workspace.nvim.input('<esc>')
    let s = result.structuredContent
    assert.notStrictEqual(s.selection, null)
    assert.strictEqual(s.selection.text, '  return 42\n}\n')
    assert.deepStrictEqual(s.selection.range.start, { line: 1, character: 0 })
    assert.deepStrictEqual(s.selection.range.end, { line: 3, character: 0 })
  })

  it('editor/state normalizes a backwards visual selection', async t => {
    await workspace.nvim.call('cursor', [2, 8])
    await workspace.nvim.input('v0')
    let result = await tool().handler({}, { token })
    await workspace.nvim.input('<esc>')
    let selection = result.structuredContent.selection
    assert.strictEqual(selection.text, '  return')
    assert.deepStrictEqual(selection.range.start, { line: 1, character: 0 })
    assert.deepStrictEqual(selection.range.end, { line: 1, character: 8 })
  })

  it('editor/state returns the innermost symbol at the cursor', async t => {
    let child = DocumentSymbol.create('inner', undefined, SymbolKind.Function, Range.create(1, 0, 1, 11), Range.create(1, 2, 1, 8))
    let parent = DocumentSymbol.create('outer', undefined, SymbolKind.Module, Range.create(0, 0, 2, 1), Range.create(0, 0, 0, 8))
    parent.children = [child]
    let disposable = languages.registerDocumentSymbolProvider([{ language: 'typescript' }], {
      provideDocumentSymbols: () => [parent]
    })
    lspQueryCache.clear()
    try {
      await workspace.nvim.call('cursor', [2, 3])
      let result = await tool().handler({}, { token })
      assert.deepStrictEqual(result.structuredContent.symbol, { name: 'inner', kind: 'function' })
    } finally {
      disposable.dispose()
      lspQueryCache.clear()
    }
  })

  it('editor/state returns an error without an active editor', async t => {
    const proto = Object.getPrototypeOf(window)
    const desc = Object.getOwnPropertyDescriptor(proto, 'activeTextEditor')
    // Patch the prototype getter (not the shared singleton) so an aborted run
    // cannot leave a stray instance property behind; restore the original
    // descriptor in finally.
    Object.defineProperty(proto, 'activeTextEditor', { ...desc, get: () => undefined })
    try {
      let result = await tool().handler({}, { token })
      assert.strictEqual(result.isError, true)
      assert.strictEqual(result.content[0].text, 'No active editor')
    } finally {
      Object.defineProperty(proto, 'activeTextEditor', desc)
    }
  })

  it('editor/state returns null selection outside visual mode', async t => {
    await workspace.nvim.input('v<esc>')
    let result = await tool().handler({}, { token })
    assert.strictEqual(result.structuredContent.selection, null)
  })
})
