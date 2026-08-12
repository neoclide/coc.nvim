import * as shared from '../sharedUtil'
'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Position, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { createDocumentTools } from '../../mcp/tools/document'
import { CancellationToken } from '../../util/protocol'
import workspace from '../../workspace'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let disposables: { dispose(): void }[] = []
let tmpdir: string
let file: string
let uri: string
const token = CancellationToken.None

before(async () => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-doc-'))
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  file = path.join(tmpdir, 'sample.txt')
  uri = URI.file(file).toString()
})

beforeEach(async () => {
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  fs.writeFileSync(file, 'alpha\nbeta\ngamma\n')
  await workspace.nvim.command(`edit! ${file}`)
  await shared.waitValue(() => !!workspace.getDocument(uri), true)
})

afterEach((t: any) => {
  for (let d of disposables) d.dispose()
  disposables = []
  // Restore per-test RPC mocks before the next fixture setup.
  t.mock.restoreAll()
})

after(async () => {
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function ensureBigFile(): string {
  let big = path.join(tmpdir, 'big.txt')
  if (!fs.existsSync(big)) {
    let content: string[] = []
    for (let i = 0; i < 400000; i++) content.push(`line-${i}`)
    fs.writeFileSync(big, content.join('\n') + '\n')
  }
  return big
}

function tool(name: string) {
  return createDocumentTools().find(t => t.name === name)!
}

describe('mcp document tools', () => {
  it('document/read returns unsaved buffer changes', async t => {
    await workspace.nvim.call('setline', [2, 'changed-line'])
    let result = await tool('document/read').handler({ uri: file }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.fromBuffer, true)
    assert.ok(result.structuredContent.text.includes('changed-line'))
    assert.ok(!fs.readFileSync(file, 'utf8').includes('changed-line'))
  })

  it('document/read supports line windows and ranges', async t => {
    await workspace.nvim.call('setline', [2, 'changed-line'])
    let result = await tool('document/read').handler({ uri: file, startLine: 1, endLine: 3 }, { token })
    assert.strictEqual(result.structuredContent.text, 'changed-line\ngamma')
    let doc = workspace.getDocument(uri)!
    let full = result.structuredContent.lineCount
    assert.strictEqual(full, doc.lineCount)
    let range = await tool('document/read').handler({
      uri: file,
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }
    }, { token })
    assert.strictEqual(range.structuredContent.text, 'lph')
  })

  it('document/read and read_lines report missing disk files', async t => {
    let missing = path.join(tmpdir, 'missing.txt')
    for (let args of [
      { uri: missing },
      { uri: missing, startLine: 0, endLine: 2 },
      { uri: missing, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } }
    ]) {
      let result = await tool('document/read').handler(args, { token })
      assert.strictEqual(result.isError, true)
    }
    let lines = await tool('document/read_lines').handler({ uri: missing }, { token })
    assert.strictEqual(lines.isError, true)
  })

  it('document/read falls back to disk for unopened files', async t => {
    let other = path.join(tmpdir, 'unopened.txt')
    fs.writeFileSync(other, 'disk content\n')
    let result = await tool('document/read').handler({ uri: other }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.fromBuffer, false)
    assert.strictEqual(result.structuredContent.text, 'disk content\n')
    let lines = await tool('document/read_lines').handler({ uri: other, startLine: 0, endLine: 1 }, { token })
    assert.deepStrictEqual(lines.structuredContent.lines, [{ line: 0, text: 'disk content' }])
    let startOnly = await tool('document/read').handler({ uri: other, startLine: -1 }, { token })
    assert.strictEqual(startOnly.structuredContent.text, 'disk content')
    let endOnly = await tool('document/read').handler({ uri: other, endLine: 1 }, { token })
    assert.strictEqual(endOnly.structuredContent.text, 'disk content')
  })

  it('document/read reads a line window from a large unopened file', async t => {
    let big = ensureBigFile()
    let result = await tool('document/read').handler({ uri: big, startLine: 100, endLine: 103 }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.fromBuffer, false)
    assert.strictEqual(result.structuredContent.text, 'line-100\nline-101\nline-102')
  })

  it('document/read reads an exact LSP range from a large unopened file', async t => {
    let big = ensureBigFile()
    let result = await tool('document/read').handler({
      uri: big,
      range: { start: { line: 5, character: 3 }, end: { line: 7, character: 2 } }
    }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.text, 'e-5\nline-6\nli')
  })

  it('document/read rejects full reads of files over the size cap', async t => {
    let big = ensureBigFile()
    let result = await tool('document/read').handler({ uri: big }, { token })
    assert.strictEqual(result.isError, true)
    assert.ok(result.content[0].text.includes('exceeds'))
  })

  it('document/read rejects symlink paths that escape the workspace', async t => {
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
      assert.strictEqual(result.isError, true)
      assert.ok(result.content[0].text.includes('not allowed'))
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('document/read_lines reads a window from a large unopened file', async t => {
    let big = ensureBigFile()
    let result = await tool('document/read_lines').handler({ uri: big, startLine: 0, endLine: 2 }, { token })
    assert.ok(!result.isError)
    assert.deepStrictEqual(result.structuredContent.lines, [
      { line: 0, text: 'line-0' },
      { line: 1, text: 'line-1' }
    ])
  })

  it('document/read_lines returns numbered lines', async t => {
    await workspace.nvim.call('setline', [2, 'changed-line'])
    let result = await tool('document/read_lines').handler({ uri: file, startLine: 0, endLine: 2 }, { token })
    assert.deepStrictEqual(result.structuredContent.lines, [
      { line: 0, text: 'alpha' },
      { line: 1, text: 'changed-line' }
    ])
  })

  it('document/read_lines rejects paths outside the workspace', async t => {
    assert.strictEqual((await tool('document/read_lines').handler({ uri: '/etc/passwd' }, { token })).isError, true)
  })

  it('document/read_lines caps the window with maxLines', async t => {
    let result = await tool('document/read_lines').handler({ uri: file, startLine: 0, endLine: 10, maxLines: 2 }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.lines.length, 2)
    assert.strictEqual(result.structuredContent.endLine, 2)
    let defaulted = await tool('document/read_lines').handler({ uri: file, maxLines: 0 }, { token })
    assert.strictEqual(defaulted.structuredContent.lines.length, 1)
  })

  it('document/apply_edits updates the buffer and fires didChange', async t => {
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
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.applied, true)
    assert.ok(result.structuredContent.version > version)
    let lines = await workspace.nvim.call('getline', [1, '$']) as string[]
    assert.ok(lines.join('\n').includes('zeta'))
    assert.ok(fs.readFileSync(file, 'utf8').includes('alpha'))
    assert.ok(changed.length > 0)
  })

  it('document/apply_edits rejects stale versions with a conflict result', async t => {
    let doc = workspace.getDocument(uri)!
    let result = await tool('document/apply_edits').handler({
      uri: file,
      version: doc.version - 10,
      target: 'buffer',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }]
    }, { token })
    assert.strictEqual(result.isError, true)
    assert.ok(result.content[0].text.includes('version conflict'))
  })

  it('document/apply_edits rejects malformed edits', async t => {
    let result = await tool('document/apply_edits').handler({
      uri: file,
      edits: 'not-an-array'
    }, { token })
    assert.strictEqual(result.isError, true)
  })

  it('document/apply_edits reports editor failures', async t => {
    let doc = workspace.getDocument(uri)!
    let spy = t.mock.method(doc, 'applyEdits', async () => { throw new Error('apply failed') })
    try {
      let result = await tool('document/apply_edits').handler({
        uri: file,
        target: 'buffer',
        edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }]
      }, { token })
      assert.ok(result.content[0].text.includes('apply failed'))
    } finally {
    }
  })

  it('document/apply_edits with target both writes disk', async t => {
    let doc = workspace.getDocument(uri)!
    let result = await tool('document/apply_edits').handler({
      uri: file,
      version: doc.version,
      target: 'both',
      edits: [{ range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }, newText: 'delta' }]
    }, { token })
    assert.ok(!result.isError)
    assert.ok(fs.readFileSync(file, 'utf8').includes('delta'))
  })

  it('edits can be reverted with undo', async t => {
    let before = ((await workspace.nvim.call('getline', [1, '$'])) as string[]).join('\n')
    let result = await tool('document/apply_edits').handler({
      uri: file,
      target: 'buffer',
      joinUndo: false,
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: '----' }]
    }, { token })
    assert.ok(!result.isError)
    let after = ((await workspace.nvim.call('getline', [1, '$'])) as string[]).join('\n')
    assert.notStrictEqual(after, before)
    await workspace.nvim.command('undo')
    let reverted = ((await workspace.nvim.call('getline', [1, '$'])) as string[]).join('\n')
    assert.strictEqual(reverted, before)
  })

  it('document/write saves the buffer to disk', async t => {
    await workspace.nvim.call('setline', [1, 'saved-line'])
    let result = await tool('document/write').handler({ uri: file }, { token })
    assert.ok(!result.isError)
    assert.ok(fs.readFileSync(file, 'utf8').includes('saved-line'))
  })

  it('document/write saves an unopened file after loading it', async t => {
    let other = path.join(tmpdir, 'write-unopened.txt')
    fs.writeFileSync(other, 'before\n')
    let result = await tool('document/write').handler({ uri: other }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.saved, true)
    assert.strictEqual(fs.readFileSync(other, 'utf8'), 'before\n')
  })

  it('document/write reports save failures', async t => {
    let spy = t.mock.method(workspace.nvim, 'call', async () => { throw new Error('save failed') })
    try {
      let result = await tool('document/write').handler({ uri: file }, { token })
      assert.strictEqual(result.isError, true)
      assert.ok(result.content[0].text.includes('save failed'))
    } finally {
    }
  })

  it('document/format without a provider returns formatted false', async t => {
    let result = await tool('document/format').handler({ uri: file }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.formatted, false)
  })

  it('document/format applies provider edits', async t => {
    let disposable = languages.registerDocumentFormatProvider([{ language: '*' }], {
      provideDocumentFormattingEdits: (document) => {
        return [TextEdit.insert(Position.create(0, 0), '// formatted\n')]
      }
    })
    disposables.push(disposable)
    let result = await tool('document/format').handler({ uri: file }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.formatted, true)
    assert.strictEqual(result.structuredContent.editCount, 1)
    let lines = await workspace.nvim.call('getline', [1, '$']) as string[]
    assert.ok(lines[0].includes('formatted'))
  })

  it('document/format applies range provider edits', async t => {
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
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.formatted, true)
    let lines = await workspace.nvim.call('getline', [1, '$']) as string[]
    assert.ok(lines[0].includes('R'))
  })

  it('document/open loads a file into a buffer', async t => {
    let other = path.join(tmpdir, 'other.txt')
    fs.writeFileSync(other, 'other content\n')
    let result = await tool('document/open').handler({ uri: other }, { token })
    assert.ok(!result.isError)
    await shared.waitValue(() => workspace.nvim.call('bufloaded', [other]), 1)
  })

  it('document/open opens multiple files at the requested lines', async t => {
    let f1 = path.join(tmpdir, 'open-a.txt')
    let f2 = path.join(tmpdir, 'open-b.txt')
    fs.writeFileSync(f1, 'a1\na2\na3\n')
    fs.writeFileSync(f2, 'b1\nb2\nb3\n')
    let result = await tool('document/open').handler({
      files: [{ uri: f1, line: 2 }, { uri: f2, line: 3 }]
    }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.count, 2)
    await shared.waitValue(() => workspace.nvim.call('bufloaded', [f1]), 1)
    await shared.waitValue(() => workspace.nvim.call('bufloaded', [f2]), 1)
    // the last opened file is current, cursor at the requested 1-based line
    let lnum = await workspace.nvim.eval('line(".")') as number
    assert.strictEqual(lnum, 3)
    let lineText = await workspace.nvim.call('getline', ['.']) as string
    assert.strictEqual(lineText, 'b3')
  })

  it('document/open accepts files as plain strings', async t => {
    let f1 = path.join(tmpdir, 'open-tab-a.txt')
    let f2 = path.join(tmpdir, 'open-tab-b.txt')
    fs.writeFileSync(f1, 'ta1\n')
    fs.writeFileSync(f2, 'tb1\n')
    let result = await tool('document/open').handler({
      files: [f1, f2]
    }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.count, 2)
    await shared.waitValue(() => workspace.nvim.call('bufloaded', [f1]), 1)
    await shared.waitValue(() => workspace.nvim.call('bufloaded', [f2]), 1)
  })

  it('document/open validates targets and supports line and column fragments', async t => {
    assert.strictEqual((await tool('document/open').handler({}, { token })).isError, true)
    assert.ok((await tool('document/open').handler({ files: [] }, { token })).content[0].text.includes('no files'))
    assert.strictEqual((await tool('document/open').handler({ files: [null] }, { token })).isError, true)
    let target = path.join(tmpdir, 'open-position.txt')
    fs.writeFileSync(target, 'one\ntwo\n')
    let result = await tool('document/open').handler({ uri: target, line: 2.8, col: 2.9 }, { token })
    assert.ok(!result.isError)
    assert.deepStrictEqual(await workspace.nvim.eval('[line("."), col(".")]'), [2, 2])
  })

  it('document/open reports openResource failures', async t => {
    let spy = t.mock.method(workspace, 'openResource', async () => { throw new Error('open failed') })
    try {
      let result = await tool('document/open').handler({ uri: file }, { token })
      assert.ok(result.content[0].text.includes('open failed'))
    } finally {
    }
  })

  it('rejects paths outside the workspace', async t => {
    let result = await tool('document/read').handler({ uri: '/etc/passwd' }, { token })
    assert.strictEqual(result.isError, true)
  })

  it('document/apply_edits and document/open reject out-of-workspace paths', async t => {
    let apply = await tool('document/apply_edits').handler({
      uri: '/etc/passwd',
      edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'x' }]
    }, { token })
    assert.strictEqual(apply.isError, true)
    let open = await tool('document/open').handler({ uri: '/etc/passwd' }, { token })
    assert.strictEqual(open.isError, true)
  })
})
