import * as shared from '../sharedUtil'
'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import {
  createWorkspaceTools,
  findRg,
  getConfigValue,
  parseRgLine,
  searchWithJs,
  searchWithRg
} from '../../mcp/tools/workspace'
import { escapeRegExp } from '../../util/string'
import { CancellationToken } from '../../util/protocol'
import { which } from '../../util/node'
import workspace from '../../workspace'
import { mock } from 'node:test'

let tmpdir: string
const token = CancellationToken.None
let realCommand: (command: string, isNotify?: boolean) => Promise<void> | null
let rejectWa = false
let commandSpy: { mock: { calls: { arguments: any[] }[] } }

before(() => {
  // Intercept `:wa` so tests do not depend on the real (slow under load)
  // save-all command; everything else still reaches nvim.
  realCommand = workspace.nvim.command.bind(workspace.nvim)
  // Suite-level before hooks have no per-test MockTracker (t.mock); use the
  // module-level tracker and restore it in after().
  commandSpy = mock.method(workspace.nvim, 'command', ((command: string, isNotify?: boolean) => {
    if (command === 'wa') {
      if (rejectWa) return Promise.reject(new Error('E32: No file name'))
      return Promise.resolve()
    }
    return realCommand(command, isNotify)
  }) as any)
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-ws-'))
  fs.writeFileSync(path.join(tmpdir, 'a.ts'), 'export const hello = 1\n')
  fs.writeFileSync(path.join(tmpdir, 'b.ts'), 'const world = hello\n')
  fs.writeFileSync(path.join(tmpdir, 'note.txt'), 'plain text\n')
})

beforeEach(() => {
  // The file-level editor reset clears workspace folders between tests;
  // re-register the search root so the per-test file operations stay scoped.
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
})

after(async () => {
  mock.restoreAll()
  workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function tool(name: string) {
  return createWorkspaceTools().find(t => t.name === name)!
}

describe('mcp workspace tools', () => {
  it('parses ripgrep JSON match lines', t => {
    let match = parseRgLine(JSON.stringify({
      type: 'match',
      data: {
        path: { text: '/tmp/a.ts' },
        lines: { text: '你hello\n' },
        line_number: 2,
        submatches: [{ start: 3 }]
      }
    }))
    assert.deepStrictEqual(match, { file: '/tmp/a.ts', line: 1, column: 1, text: '你hello' })
    assert.deepStrictEqual(parseRgLine(JSON.stringify({
      type: 'match',
      data: { path: { text: '/tmp/a.ts' }, lines: { text: 1 } }
    })), { file: '/tmp/a.ts', line: 0, column: 0, text: '' })
    assert.strictEqual(parseRgLine('{invalid'), null)
    assert.strictEqual(parseRgLine(JSON.stringify({ type: 'summary' })), null)
    assert.strictEqual(parseRgLine(JSON.stringify({ type: 'match' })), null)
    assert.strictEqual(parseRgLine(JSON.stringify({ type: 'match', data: {} })), null)
    assert.strictEqual(parseRgLine(JSON.stringify({ type: 'match', data: { path: {} } })), null)
    assert.deepStrictEqual(parseRgLine(JSON.stringify({
      type: 'match', data: { path: { text: '/tmp/b.ts' }, lines: { text: 'text' }, submatches: [] }
    })), { file: '/tmp/b.ts', line: 0, column: 0, text: 'text' })
  })

  it('escapes regex syntax and reads nested configuration', t => {
    assert.strictEqual(escapeRegExp('a.*[b]'), 'a\\.\\*\\[b\\]')
    assert.strictEqual(getConfigValue('mcp.autoStart'), false)
    assert.strictEqual(getConfigValue('mcp.notFound'), undefined)
    assert.strictEqual(getConfigValue('mcp.notFound.child'), undefined)
    assert.ok(getConfigValue(''))
  })

  it('runs ripgrep with case and glob options and stops at maxResults', async t => {
    assert.ok(findRg())
    let matches = await searchWithRg('HELLO', {
      caseSensitive: false,
      include: '**/*.ts',
      exclude: 'b.ts'
    }, tmpdir, 1)
    assert.strictEqual(matches.length, 1)
    assert.strictEqual(path.basename(matches[0].file), 'a.ts')
    let exact = await searchWithRg('hello', { regex: true, caseSensitive: true }, tmpdir, 10)
    assert.ok(exact.length > 0)
  })

  it('workspace/files lists files by glob', async t => {
    let result = await tool('workspace/files').handler({ include: '**/*.ts' }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.count, 2)
    let names = result.structuredContent.files.map((f: any) => path.basename(f.filepath)).sort()
    assert.deepStrictEqual(names, ['a.ts', 'b.ts'])
  })

  it('workspace/search finds matches with line and column', async t => {
    let result = await tool('workspace/search').handler({
      pattern: 'hello',
      include: '**/*.ts',
      root: tmpdir
    }, { token })
    assert.ok(!result.isError)
    assert.ok(result.structuredContent.count > 0)
    let match = result.structuredContent.matches.find((m: any) => path.basename(m.file) === 'a.ts')
    assert.ok(match)
    assert.ok(match.text.includes('hello'))
    assert.strictEqual(typeof match.line, 'number')
  })

  it('workspace/search supports regex mode and the JS fallback', async t => {
    let regexResult = await tool('workspace/search').handler({
      pattern: 'h.llo',
      regex: true,
      include: '**/*.ts',
      root: tmpdir
    }, { token })
    assert.ok(!regexResult.isError)
    assert.ok(regexResult.structuredContent.count > 0)
    let jsMatches = await searchWithJs('hello', { include: '**/*.ts' }, tmpdir, 100)
    assert.ok(jsMatches.length > 0)
    assert.ok(jsMatches[0].text.includes('hello'))
  })

  it('workspace/search falls back when ripgrep is unavailable', async t => {
    t.mock.method(which, 'sync', () => { throw new Error('missing') })
    try {
      assert.strictEqual(findRg(), null)
      let result = await tool('workspace/search').handler({ pattern: 'hello', include: '**/*.ts', root: tmpdir }, { token })
      assert.ok(!result.isError)
      assert.strictEqual(result.structuredContent.engine, 'js')
    } finally {}
  })

  it('workspace/search reports non-Error fallback failures', async t => {
    t.mock.method(which, 'sync', () => { throw new Error('missing') })
    let findFiles = workspace.findFiles.bind(workspace)
    let calls = 0
    t.mock.method(workspace, 'findFiles', async (...args: any[]) => {
      calls++
      // oxlint-disable-next-line typescript/only-throw-error
      if (calls === 1) throw 'find failed'
      return (findFiles as any)(...args)
    })
    try {
      let result = await tool('workspace/search').handler({ pattern: 'hello', root: tmpdir }, { token })
      assert.ok(result.content[0].text.includes('find failed'))
    } finally {}
  })

  it('workspace/configuration accepts an omitted key', async t => {
    let result = await tool('workspace/configuration').handler({}, { token })
    assert.strictEqual(result.structuredContent.key, '')
    assert.ok(result.structuredContent.value)
  })

  it('workspace/search filters files in deniedPaths and scopes to the root', async t => {
    let keepDir = path.join(tmpdir, 'keep')
    let deniedDir = path.join(tmpdir, 'denied-sub')
    fs.mkdirSync(keepDir, { recursive: true })
    fs.mkdirSync(deniedDir, { recursive: true })
    fs.writeFileSync(path.join(keepDir, 'keep.ts'), 'needle in keep\n')
    fs.writeFileSync(path.join(deniedDir, 'hidden.ts'), 'needle in denied\n')
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**')],
      'mcp.deniedPaths': [path.join(deniedDir, '**')]
    })
    try {
      let rgResult = await tool('workspace/search').handler({
        pattern: 'needle',
        include: '**/*.ts',
        root: tmpdir
      }, { token })
      assert.ok(!rgResult.isError)
      let rgFiles = rgResult.structuredContent.matches.map((m: any) => m.file)
      assert.ok(rgFiles.includes(path.join(keepDir, 'keep.ts')))
      assert.strictEqual(rgFiles.some(f => f.includes('denied-sub')), false)
      let jsMatches = await searchWithJs('needle', { include: '**/*.ts' }, tmpdir, 100)
      let jsFiles = jsMatches.map(m => m.file)
      assert.ok(jsFiles.includes(path.join(keepDir, 'keep.ts')))
      assert.strictEqual(jsFiles.some(f => f.includes('denied-sub')), false)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
    }
  })

  it('JS search fallback does not return files outside the requested root', async t => {
    let otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-other-'))
    fs.writeFileSync(path.join(otherDir, 'other.ts'), 'needle in other\n')
    workspace.workspaceFolderControl.addWorkspaceFolder(otherDir, true)
    try {
      let jsMatches = await searchWithJs('needle', { include: '**/*.ts' }, tmpdir, 100)
      assert.strictEqual(jsMatches.some(m => m.file.includes('other.ts')), false)
    } finally {
      workspace.workspaceFolderControl.removeWorkspaceFolder(otherDir)
      fs.rmSync(otherDir, { recursive: true, force: true })
    }
  })

  it('JS search does not drop adjacent matching lines', async t => {
    let file = path.join(tmpdir, 'adjacent.txt')
    fs.writeFileSync(file, 'hello\nhello world\nworld\n')
    let matches = await searchWithJs('hello', { include: 'adjacent.txt' }, tmpdir, 100)
    let lines = matches.filter(m => m.file === file).map(m => m.line)
    assert.deepStrictEqual(lines, [0, 1])
    let columns = matches.filter(m => m.file === file).map(m => m.column)
    assert.deepStrictEqual(columns, [0, 0])
  })

  it('JS search handles empty-match regex without hanging', async t => {
    let file = path.join(tmpdir, 'empty-match.txt')
    fs.writeFileSync(file, 'abc\nxyz\n')
    let matches = await searchWithJs('x*', { regex: true, include: 'empty-match.txt' }, tmpdir, 100)
    // 'x*' matches once at index 0 of every line (including the trailing
    // empty line) without looping forever
    assert.deepStrictEqual(matches.filter(m => m.file === file).map(m => m.line), [0, 1, 2])
  })

  it('JS search handles defaults, case sensitivity, limits and skipped files', async t => {
    let binary = path.join(tmpdir, 'binary.dat')
    let large = path.join(tmpdir, 'large.dat')
    fs.writeFileSync(binary, 'hello\0world')
    fs.writeFileSync(large, 'hello' + 'x'.repeat(2 * 1024 * 1024))
    assert.deepStrictEqual(await searchWithJs('HELLO', { caseSensitive: true }, tmpdir, 10), [])
    let limited = await searchWithJs('hello', {}, tmpdir, 1)
    assert.strictEqual(limited.length, 1)
    await assert.rejects(searchWithJs('[', { regex: true }, tmpdir, 10), new RegExp('Invalid regex'))
  })

  it('validates required arguments for workspace tools', async t => {
    for (let [name, args, message] of [
      ['workspace/search', {}, 'pattern is required'],
      ['workspace/files', {}, 'include glob is required'],
      ['workspace/apply_edit', {}, 'edit (WorkspaceEdit) is required'],
      ['workspace/create_file', {}, 'filepath is required'],
      ['workspace/rename_file', {}, 'oldPath and newPath are required'],
      ['workspace/delete_file', {}, 'filepath is required']
    ] as Array<[string, Record<string, unknown>, string]>) {
      let result = await tool(name).handler(args, { token })
      assert.strictEqual(result.isError, true)
      assert.ok(result.content[0].text.includes(message))
    }
  })

  it('reports workspace operation failures', async t => {
    t.mock.method(workspace, 'createFile', async () => { throw new Error('create failed') })
    t.mock.method(workspace, 'renameFile', async () => { throw new Error('rename failed') })
    t.mock.method(workspace, 'deleteFile', async () => { throw new Error('delete failed') })
    t.mock.method(workspace, 'applyEdit', async () => { throw new Error('apply failed') })
    let create = await tool('workspace/create_file').handler({ filepath: path.join(tmpdir, 'fail-create') }, { token })
    assert.ok(create.content[0].text.includes('create failed'))
    let rename = await tool('workspace/rename_file').handler({
      oldPath: path.join(tmpdir, 'a.ts'),
      newPath: path.join(tmpdir, 'fail-rename')
    }, { token })
    assert.ok(rename.content[0].text.includes('rename failed'))
    let remove = await tool('workspace/delete_file').handler({ filepath: path.join(tmpdir, 'a.ts') }, { token })
    assert.ok(remove.content[0].text.includes('delete failed'))
    let apply = await tool('workspace/apply_edit').handler({ edit: { changes: {} } }, { token })
    assert.ok(apply.content[0].text.includes('apply failed'))
  })

  it('reports non-Error workspace operation failures', async t => {
    // oxlint-disable-next-line typescript/only-throw-error
    t.mock.method(workspace, 'createFile', async () => { throw 'create string' })
    // oxlint-disable-next-line typescript/only-throw-error
    t.mock.method(workspace, 'renameFile', async () => { throw 'rename string' })
    // oxlint-disable-next-line typescript/only-throw-error
    t.mock.method(workspace, 'deleteFile', async () => { throw 'delete string' })
    // oxlint-disable-next-line typescript/only-throw-error
    t.mock.method(workspace, 'applyEdit', async () => { throw 'apply string' })
    assert.ok((await tool('workspace/create_file').handler({ filepath: path.join(tmpdir, 'fail-create') }, { token })).content[0].text.includes('create string'))
    assert.ok((await tool('workspace/rename_file').handler({ oldPath: path.join(tmpdir, 'a.ts'), newPath: path.join(tmpdir, 'fail-rename') }, { token })).content[0].text.includes('rename string'))
    assert.ok((await tool('workspace/delete_file').handler({ filepath: path.join(tmpdir, 'a.ts') }, { token })).content[0].text.includes('delete string'))
    assert.ok((await tool('workspace/apply_edit').handler({ edit: { changes: {} } }, { token })).content[0].text.includes('apply string'))
  })

  it('workspace/create_file creates a file on disk and buffer', async t => {
    let filepath = path.join(tmpdir, 'created.txt')
    let result = await tool('workspace/create_file').handler({ filepath }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(fs.existsSync(filepath), true)
  })

  it('workspace/rename_file moves a file', async t => {
    let oldPath = path.join(tmpdir, 'created.txt')
    let newPath = path.join(tmpdir, 'renamed.txt')
    let result = await tool('workspace/rename_file').handler({ oldPath, newPath }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(fs.existsSync(oldPath), false)
    assert.strictEqual(fs.existsSync(newPath), true)
  })

  it('workspace/delete_file removes a file', async t => {
    let filepath = path.join(tmpdir, 'renamed.txt')
    let result = await tool('workspace/delete_file').handler({ filepath }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(fs.existsSync(filepath), false)
  })

  it('workspace/apply_edit applies multi-file edits to buffers', async t => {
    let x = path.join(tmpdir, 'x.txt')
    let y = path.join(tmpdir, 'y.txt')
    fs.writeFileSync(x, 'xxx\n')
    fs.writeFileSync(y, 'yyy\n')
    let ux = URI.file(x).toString()
    let uy = URI.file(y).toString()
    let result = await tool('workspace/apply_edit').handler({
      edit: {
        changes: {
          [ux]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'XX' }],
          [uy]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'YY' }]
        }
      }
    }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.applied, true)
    assert.strictEqual(result.structuredContent.pendingSave, true)
    assert.strictEqual(result.structuredContent.saved, true)
    let dx = workspace.getDocument(ux)!
    assert.ok(dx.textDocument.getText().includes('XX'))
    let dy = workspace.getDocument(uy)!
    assert.ok(dy.textDocument.getText().includes('YY'))
    // the tool saves all modified buffers with :wa
    assert.ok(commandSpy.mock.calls.some(c => c.arguments[0] === 'wa'))
  })

  it('workspace/apply_edit reports saveError when :wa fails', async t => {
    let z = path.join(tmpdir, 'z.txt')
    fs.writeFileSync(z, 'zzz\n')
    let uz = URI.file(z).toString()
    rejectWa = true
    try {
      let result = await tool('workspace/apply_edit').handler({
        edit: {
          changes: {
            [uz]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'ZZ' }]
          }
        }
      }, { token })
      assert.ok(!result.isError)
      assert.strictEqual(result.structuredContent.applied, true)
      assert.strictEqual(result.structuredContent.saved, false)
      assert.ok(result.structuredContent.saveError)
      // the edit itself was applied to the buffer
      assert.ok(workspace.getDocument(uz)!.textDocument.getText().includes('ZZ'))
    } finally {
      rejectWa = false
    }
  })

  it('workspace/apply_edit carries optional WorkspaceEditMetadata', async t => {
    let x = path.join(tmpdir, 'meta.txt')
    fs.writeFileSync(x, 'meta content\n')
    let ux = URI.file(x).toString()
    let result = await tool('workspace/apply_edit').handler({
      edit: {
        changes: {
          [ux]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }, newText: 'META' }]
        }
      },
      metadata: { isRefactoring: true }
    }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.applied, true)
    assert.deepStrictEqual(result.structuredContent.metadata, { isRefactoring: true })
  })

  it('workspace/apply_edit rejects invalid metadata', async t => {
    let x = path.join(tmpdir, 'meta-bad.txt')
    fs.writeFileSync(x, 'bad\n')
    let ux = URI.file(x).toString()
    let badType = await tool('workspace/apply_edit').handler({
      edit: { changes: { [ux]: [] } },
      metadata: 'not-an-object'
    }, { token })
    assert.strictEqual(badType.isError, true)
    let badField = await tool('workspace/apply_edit').handler({
      edit: { changes: { [ux]: [] } },
      metadata: { isRefactoring: 'yes' }
    }, { token })
    assert.strictEqual(badField.isError, true)
  })

  it('workspace/apply_edit supports create operations on disk', async t => {
    let created = path.join(tmpdir, 'apply-created.txt')
    let result = await tool('workspace/apply_edit').handler({
      edit: {
        documentChanges: [
          { kind: 'create', uri: URI.file(created).toString() }
        ]
      }
    }, { token })
    assert.ok(!result.isError)
    assert.strictEqual(result.structuredContent.applied, true)
    assert.strictEqual(fs.existsSync(created), true)
  })

  it('workspace/apply_edit rejects rename when either side is outside allowed paths', async t => {
    let inside = path.join(tmpdir, 'rename-inside.txt')
    let outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-out-'))
    let outside = path.join(outsideDir, 'rename-outside.txt')
    fs.writeFileSync(inside, 'inside\n')
    fs.writeFileSync(outside, 'outside\n')
    let insideUri = URI.file(inside).toString()
    let outsideUri = URI.file(outside).toString()
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**')],
      'mcp.deniedPaths': []
    })
    try {
      // target outside the allowed workspace
      let badTarget = await tool('workspace/apply_edit').handler({
        edit: {
          documentChanges: [{ kind: 'rename', oldUri: insideUri, newUri: outsideUri }]
        }
      }, { token })
      assert.strictEqual(badTarget.isError, true)
      assert.strictEqual(fs.readFileSync(inside, 'utf8'), 'inside\n')
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside\n')
      // source outside the allowed workspace
      let badSource = await tool('workspace/apply_edit').handler({
        edit: {
          documentChanges: [{ kind: 'rename', oldUri: outsideUri, newUri: insideUri }]
        }
      }, { token })
      assert.strictEqual(badSource.isError, true)
      assert.strictEqual(fs.readFileSync(inside, 'utf8'), 'inside\n')
      assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'outside\n')
      // both sides inside the workspace still works
      let moved = path.join(tmpdir, 'rename-moved.txt')
      let ok = await tool('workspace/apply_edit').handler({
        edit: {
          documentChanges: [{ kind: 'rename', oldUri: insideUri, newUri: URI.file(moved).toString() }]
        }
      }, { token })
      assert.ok(!ok.isError)
      assert.strictEqual(ok.structuredContent.applied, true)
      assert.strictEqual(fs.existsSync(inside), false)
      assert.strictEqual(fs.existsSync(moved), true)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects file operations matching mcp.deniedPaths', async t => {
    workspace.configurations.updateMemoryConfig({ 'mcp.deniedPaths': [path.join(tmpdir, 'secret*')] })
    let filepath = path.join(tmpdir, 'secret.txt')
    let result = await tool('workspace/create_file').handler({ filepath }, { token })
    assert.strictEqual(result.isError, true)
    assert.strictEqual(fs.existsSync(filepath), false)
  })

  it('rejects write tools that reach outside the workspace through symlinks', async t => {
    let outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-out-'))
    let outsideFile = path.join(outsideDir, 'target.txt')
    fs.writeFileSync(outsideFile, 'secret\n')
    let link = path.join(tmpdir, 'escape-link')
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
      let create = await tool('workspace/create_file').handler({ filepath: path.join(link, 'new.txt') }, { token })
      assert.strictEqual(create.isError, true)
      assert.strictEqual(fs.existsSync(path.join(outsideDir, 'new.txt')), false)
      let rename = await tool('workspace/rename_file').handler({
        oldPath: path.join(link, 'target.txt'),
        newPath: path.join(tmpdir, 'stolen.txt')
      }, { token })
      assert.strictEqual(rename.isError, true)
      assert.strictEqual(fs.existsSync(outsideFile), true)
      assert.strictEqual(fs.existsSync(path.join(tmpdir, 'stolen.txt')), false)
      let del = await tool('workspace/delete_file').handler({ filepath: path.join(link, 'target.txt') }, { token })
      assert.strictEqual(del.isError, true)
      assert.strictEqual(fs.existsSync(outsideFile), true)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
