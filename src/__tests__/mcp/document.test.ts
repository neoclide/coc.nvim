'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Position, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import languages from '../../languages'
import { createDocumentTools } from '../../mcp/tools/document'
import helper from '../helper'
import { CancellationToken } from '../../util/protocol'
import workspace from '../../workspace'

let disposables: { dispose(): void }[] = []
let tmpdir: string
let file: string
let uri: string
const token = CancellationToken.None

beforeAll(async () => {
  await helper.setup()
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-doc-'))
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  file = path.join(tmpdir, 'sample.txt')
  fs.writeFileSync(file, 'alpha\nbeta\ngamma\n')
  uri = URI.file(file).toString()
  await helper.nvim.command(`edit ${file}`)
  await helper.waitValue(() => !!workspace.getDocument(uri), true)
})

afterAll(async () => {
  for (let d of disposables) d.dispose()
  await helper.shutdown()
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function tool(name: string) {
  return createDocumentTools().find(t => t.name === name)!
}

describe('mcp document tools', () => {
  it('document/read returns unsaved buffer changes', async () => {
    await helper.nvim.call('setline', [2, 'changed-line'])
    let result = await tool('document/read').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.fromBuffer).toBe(true)
    expect(result.structuredContent.text).toContain('changed-line')
    expect(fs.readFileSync(file, 'utf8')).not.toContain('changed-line')
  })

  it('document/read supports line windows and ranges', async () => {
    let result = await tool('document/read').handler({ uri: file, startLine: 1, endLine: 3 }, { token })
    expect(result.structuredContent.text).toBe('changed-line\ngamma')
    let doc = workspace.getDocument(uri)!
    let full = result.structuredContent.lineCount
    expect(full).toBe(doc.lineCount)
  })

  it('document/read falls back to disk for unopened files', async () => {
    let other = path.join(tmpdir, 'unopened.txt')
    fs.writeFileSync(other, 'disk content\n')
    let result = await tool('document/read').handler({ uri: other }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.fromBuffer).toBe(false)
    expect(result.structuredContent.text).toBe('disk content\n')
    let lines = await tool('document/read_lines').handler({ uri: other, startLine: 0, endLine: 1 }, { token })
    expect(lines.structuredContent.lines).toEqual([{ line: 0, text: 'disk content' }])
  })

  it('document/read reads a line window from a large unopened file', async () => {
    let big = path.join(tmpdir, 'big.txt')
    let content: string[] = []
    for (let i = 0; i < 400000; i++) content.push(`line-${i}`)
    fs.writeFileSync(big, content.join('\n') + '\n')
    let result = await tool('document/read').handler({ uri: big, startLine: 100, endLine: 103 }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.fromBuffer).toBe(false)
    expect(result.structuredContent.text).toBe('line-100\nline-101\nline-102')
  })

  it('document/read reads an exact LSP range from a large unopened file', async () => {
    let big = path.join(tmpdir, 'big.txt')
    let result = await tool('document/read').handler({
      uri: big,
      range: { start: { line: 5, character: 3 }, end: { line: 7, character: 2 } }
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.text).toBe('e-5\nline-6\nli')
  })

  it('document/read rejects full reads of files over the size cap', async () => {
    let big = path.join(tmpdir, 'big.txt')
    let result = await tool('document/read').handler({ uri: big }, { token })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds')
  })

  it('document/read rejects symlink paths that escape the workspace', async () => {
    let outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-doc-out-'))
    let outsideFile = path.join(outsideDir, 'secret.txt')
    fs.writeFileSync(outsideFile, 'secret\n')
    let link = path.join(tmpdir, 'read-link')
    try {
      fs.symlinkSync(outsideDir, link)
    } catch (_e) {
      fs.rmSync(outsideDir, { recursive: true, force: true })
      return // platform without symlink privilege
    }
    // Scope access to the workspace so the canonical target (outside) can
    // never match, regardless of other workspace folders in the test env.
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**')],
      'mcp.deniedPaths': []
    })
    try {
      let result = await tool('document/read').handler({ uri: path.join(link, 'secret.txt') }, { token })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('not allowed')
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('document/read_lines reads a window from a large unopened file', async () => {
    let big = path.join(tmpdir, 'big.txt')
    let result = await tool('document/read_lines').handler({ uri: big, startLine: 0, endLine: 2 }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.lines).toEqual([
      { line: 0, text: 'line-0' },
      { line: 1, text: 'line-1' }
    ])
  })

  it('document/read_lines returns numbered lines', async () => {
    let result = await tool('document/read_lines').handler({ uri: file, startLine: 0, endLine: 2 }, { token })
    expect(result.structuredContent.lines).toEqual([
      { line: 0, text: 'alpha' },
      { line: 1, text: 'changed-line' }
    ])
  })

  it('document/read_lines caps the window with maxLines', async () => {
    let result = await tool('document/read_lines').handler({ uri: file, startLine: 0, endLine: 10, maxLines: 2 }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.lines.length).toBe(2)
    expect(result.structuredContent.endLine).toBe(2)
  })

  it('document/apply_edits updates the buffer and fires didChange', async () => {
    let doc = workspace.getDocument(uri)!
    let version = doc.version
    let changed: any[] = []
    let disposable = workspace.onDidChangeTextDocument(e => {
      if (e.textDocument.uri === uri) changed.push(e)
    })
    disposables.push(disposable)
    let result = await tool('document/apply_edits').handler({
      uri: file,
      version,
      target: 'buffer',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: 'zeta' }]
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.applied).toBe(true)
    expect(result.structuredContent.version).toBeGreaterThan(version)
    let lines = await helper.nvim.call('getline', [1, '$']) as string[]
    expect(lines.join('\n')).toContain('zeta')
    expect(fs.readFileSync(file, 'utf8')).toContain('alpha')
    expect(changed.length).toBeGreaterThan(0)
  })

  it('document/apply_edits rejects stale versions with a conflict result', async () => {
    let doc = workspace.getDocument(uri)!
    let result = await tool('document/apply_edits').handler({
      uri: file,
      version: doc.version - 10,
      target: 'buffer',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }]
    }, { token })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('version conflict')
  })

  it('document/apply_edits rejects malformed edits', async () => {
    let result = await tool('document/apply_edits').handler({
      uri: file,
      edits: 'not-an-array'
    }, { token })
    expect(result.isError).toBe(true)
  })

  it('document/apply_edits with target both writes disk', async () => {
    let doc = workspace.getDocument(uri)!
    let result = await tool('document/apply_edits').handler({
      uri: file,
      version: doc.version,
      target: 'both',
      edits: [{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, newText: 'delta' }]
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(fs.readFileSync(file, 'utf8')).toContain('delta')
  })

  it('edits can be reverted with undo', async () => {
    let before = ((await helper.nvim.call('getline', [1, '$'])) as string[]).join('\n')
    let result = await tool('document/apply_edits').handler({
      uri: file,
      target: 'buffer',
      joinUndo: false,
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: '----' }]
    }, { token })
    expect(result.isError).toBeFalsy()
    let after = ((await helper.nvim.call('getline', [1, '$'])) as string[]).join('\n')
    expect(after).not.toBe(before)
    await helper.nvim.command('undo')
    let reverted = ((await helper.nvim.call('getline', [1, '$'])) as string[]).join('\n')
    expect(reverted).toBe(before)
  })

  it('document/write saves the buffer to disk', async () => {
    await helper.nvim.call('setline', [1, 'saved-line'])
    let result = await tool('document/write').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(fs.readFileSync(file, 'utf8')).toContain('saved-line')
  })

  it('document/write saves an unopened file after loading it', async () => {
    let other = path.join(tmpdir, 'write-unopened.txt')
    fs.writeFileSync(other, 'before\n')
    let result = await tool('document/write').handler({ uri: other }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.saved).toBe(true)
    expect(fs.readFileSync(other, 'utf8')).toBe('before\n')
  })

  it('document/format without a provider returns formatted false', async () => {
    let result = await tool('document/format').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.formatted).toBe(false)
  })

  it('document/format applies provider edits', async () => {
    let disposable = languages.registerDocumentFormatProvider([{ language: '*' }], {
      provideDocumentFormattingEdits: (document) => {
        return [TextEdit.insert(Position.create(0, 0), '// formatted\n')]
      }
    })
    disposables.push(disposable)
    let result = await tool('document/format').handler({ uri: file }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.formatted).toBe(true)
    expect(result.structuredContent.editCount).toBe(1)
    let lines = await helper.nvim.call('getline', [1, '$']) as string[]
    expect(lines[0]).toContain('formatted')
  })

  it('document/format applies range provider edits', async () => {
    let disposable = languages.registerDocumentRangeFormatProvider([{ language: '*' }], {
      provideDocumentRangeFormattingEdits: (document, range) => {
        return [TextEdit.insert(range.start, 'R')]
      }
    })
    disposables.push(disposable)
    let result = await tool('document/format').handler({
      uri: file,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.formatted).toBe(true)
    let lines = await helper.nvim.call('getline', [1, '$']) as string[]
    expect(lines[0]).toContain('R')
  })

  it('document/open loads a file into a buffer', async () => {
    let other = path.join(tmpdir, 'other.txt')
    fs.writeFileSync(other, 'other content\n')
    let result = await tool('document/open').handler({ uri: other }, { token })
    expect(result.isError).toBeFalsy()
    await helper.waitValue(() => helper.nvim.call('bufloaded', [other]), 1)
  })

  it('document/open opens multiple files at the requested lines', async () => {
    let f1 = path.join(tmpdir, 'open-a.txt')
    let f2 = path.join(tmpdir, 'open-b.txt')
    fs.writeFileSync(f1, 'a1\na2\na3\n')
    fs.writeFileSync(f2, 'b1\nb2\nb3\n')
    let result = await tool('document/open').handler({
      files: [{ uri: f1, line: 2 }, { uri: f2, line: 3 }]
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(2)
    await helper.waitValue(() => helper.nvim.call('bufloaded', [f1]), 1)
    await helper.waitValue(() => helper.nvim.call('bufloaded', [f2]), 1)
    // the last opened file is current, cursor at the requested 1-based line
    let lnum = await helper.nvim.eval('line(".")') as number
    expect(lnum).toBe(3)
    let lineText = await helper.nvim.call('getline', ['.']) as string
    expect(lineText).toBe('b3')
  })

  it('document/open accepts files as plain strings', async () => {
    let f1 = path.join(tmpdir, 'open-tab-a.txt')
    let f2 = path.join(tmpdir, 'open-tab-b.txt')
    fs.writeFileSync(f1, 'ta1\n')
    fs.writeFileSync(f2, 'tb1\n')
    let result = await tool('document/open').handler({
      files: [f1, f2]
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(2)
    await helper.waitValue(() => helper.nvim.call('bufloaded', [f1]), 1)
    await helper.waitValue(() => helper.nvim.call('bufloaded', [f2]), 1)
  })

  it('rejects paths outside the workspace', async () => {
    let result = await tool('document/read').handler({ uri: '/etc/passwd' }, { token })
    expect(result.isError).toBe(true)
  })

  it('document/apply_edits and document/open reject out-of-workspace paths', async () => {
    let apply = await tool('document/apply_edits').handler({
      uri: '/etc/passwd',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }]
    }, { token })
    expect(apply.isError).toBe(true)
    let open = await tool('document/open').handler({ uri: '/etc/passwd' }, { token })
    expect(open.isError).toBe(true)
  })
})
