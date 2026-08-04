'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEditorTools } from '../../mcp/tools/editor'
import helper from '../helper'
import { CancellationToken } from '../../util/protocol'
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

  it('editor/state returns null selection outside visual mode', async () => {
    await helper.nvim.input('v<esc>')
    let result = await tool().handler({}, { token })
    expect(result.structuredContent.selection).toBeNull()
  })
})
