'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DocumentSymbol, Position, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
  it('exports editor state helpers for edge-case testing', async () => {
    let doc: any = {
      lineCount: 2,
      getLines: (start: number) => start === 0 ? ['alpha'] : [''],
      textDocument: { getText: () => 'selection' }
    }
    expect(lineText(doc, -1)).toBe('')
    expect(lineText(doc, 2)).toBe('')
    expect(lineText(doc, 0)).toBe('alpha')
    expect(lineText(doc, 1)).toBe('')
    expect(innermostSymbol(null, Position.create(0, 0))).toBeNull()
    let outside = DocumentSymbol.create('outside', undefined, SymbolKind.File, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1))
    expect(innermostSymbol([outside], Position.create(0, 0))).toBeNull()

    let nvim: any = {
      call: vi.fn().mockResolvedValue('v'),
      eval: vi.fn()
        .mockResolvedValueOnce([1, 1, 1, 1, true])
        .mockResolvedValueOnce(['', ''])
    }
    expect((await getVisualSelection(doc, nvim))!.range).toEqual(Range.create(0, 0, 0, 1))
  })

  it('editor/state returns active editor state', async () => {
    await helper.nvim.call('cursor', [2, 3])
    let result = await tool().handler({}, { token })
    expect(result.isError).toBeFalsy()
    let s = result.structuredContent
    expect(s.workspace).toBe(workspace.root)
    expect(s.document.uri).toBe(uri)
    expect(s.document.language).toBe('typescript')
    expect(s.document.version).toBeGreaterThan(0)
    expect(s.cursor).toEqual({ line: 1, character: 2 })
    expect(s.surroundingCode).toEqual({
      before: 'function foo() {',
      current: '  return 42',
      after: '}'
    })
    expect(s.selection).toBeNull()
    expect(s.visibleRange.start).toBeLessThanOrEqual(1)
    expect(s.visibleRange.end).toBeGreaterThanOrEqual(1)
    expect(s.visibleRange.lines).toContain('  return 42')
    expect(Array.isArray(s.diagnostics)).toBe(true)
    expect(s.symbol).toBeNull()
  })

  it('editor/state returns visual selection', async () => {
    await helper.nvim.call('cursor', [2, 1])
    await helper.nvim.input('v$')
    let result = await tool().handler({}, { token })
    await helper.nvim.input('<esc>')
    let s = result.structuredContent
    expect(s.selection).not.toBeNull()
    expect(s.selection.text).toBe('  return 42')
    expect(s.selection.range.start).toEqual({ line: 1, character: 0 })
    expect(s.selection.range.end).toEqual({ line: 1, character: '  return 42'.length })
  })

  it('editor/state returns linewise visual selection', async () => {
    await helper.nvim.call('cursor', [2, 1])
    await helper.nvim.input('Vj')
    let result = await tool().handler({}, { token })
    await helper.nvim.input('<esc>')
    let s = result.structuredContent
    expect(s.selection).not.toBeNull()
    expect(s.selection.text).toBe('  return 42\n}\n')
    expect(s.selection.range.start).toEqual({ line: 1, character: 0 })
    expect(s.selection.range.end).toEqual({ line: 3, character: 0 })
  })

  it('editor/state normalizes a backwards visual selection', async () => {
    await helper.nvim.call('cursor', [2, 8])
    await helper.nvim.input('v0')
    let result = await tool().handler({}, { token })
    await helper.nvim.input('<esc>')
    let selection = result.structuredContent.selection
    expect(selection.text).toBe('  return')
    expect(selection.range.start).toEqual({ line: 1, character: 0 })
    expect(selection.range.end).toEqual({ line: 1, character: 8 })
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
      expect(result.structuredContent.symbol).toEqual({ name: 'inner', kind: 'function' })
    } finally {
      disposable.dispose()
      lspQueryCache.clear()
    }
  })

  it('editor/state returns an error without an active editor', async () => {
    let spy = vi.spyOn(window, 'activeTextEditor', 'get').mockReturnValue(undefined)
    try {
      let result = await tool().handler({}, { token })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe('No active editor')
    } finally {
      spy.mockRestore()
    }
  })

  it('editor/state returns null selection outside visual mode', async () => {
    await helper.nvim.input('v<esc>')
    let result = await tool().handler({}, { token })
    expect(result.structuredContent.selection).toBeNull()
  })
})
