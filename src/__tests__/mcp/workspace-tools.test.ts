'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { URI } from 'vscode-uri'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceTools,
  escapeRegExp,
  findRg,
  getConfigValue,
  parseRgLine,
  searchWithJs,
  searchWithRg
} from '../../mcp/tools/workspace'
import helper from '../helper'
import { CancellationToken } from '../../util/protocol'
import { which } from '../../util/node'
import workspace from '../../workspace'

let tmpdir: string
const token = CancellationToken.None
let realCommand: (command: string, isNotify?: boolean) => Promise<void> | null
let rejectWa = false
let commandSpy: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  await helper.setup()
  // Intercept `:wa` so tests do not depend on the real (slow under load)
  // save-all command; everything else still reaches nvim.
  realCommand = workspace.nvim.command.bind(workspace.nvim)
  commandSpy = vi.spyOn(workspace.nvim, 'command').mockImplementation(((command: string, isNotify?: boolean) => {
    if (command === 'wa') {
      if (rejectWa) return Promise.reject(new Error('E32: No file name'))
      return Promise.resolve()
    }
    return realCommand(command, isNotify)
  }) as any)
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-ws-'))
  workspace.workspaceFolderControl.addWorkspaceFolder(tmpdir, true)
  fs.writeFileSync(path.join(tmpdir, 'a.ts'), 'export const hello = 1\n')
  fs.writeFileSync(path.join(tmpdir, 'b.ts'), 'const world = hello\n')
  fs.writeFileSync(path.join(tmpdir, 'note.txt'), 'plain text\n')
})

afterAll(async () => {
  commandSpy.mockRestore()
  await helper.shutdown()
  workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

function tool(name: string) {
  return createWorkspaceTools().find(t => t.name === name)!
}

describe('mcp workspace tools', () => {
  it('parses ripgrep JSON match lines', () => {
    let match = parseRgLine(JSON.stringify({
      type: 'match',
      data: {
        path: { text: '/tmp/a.ts' },
        lines: { text: '你hello\n' },
        line_number: 2,
        submatches: [{ start: 3 }]
      }
    }))
    expect(match).toEqual({ file: '/tmp/a.ts', line: 1, column: 1, text: '你hello' })
    expect(parseRgLine(JSON.stringify({
      type: 'match',
      data: { path: { text: '/tmp/a.ts' }, lines: { text: 1 } }
    }))).toEqual({ file: '/tmp/a.ts', line: 0, column: 0, text: '' })
    expect(parseRgLine('{invalid')).toBeNull()
    expect(parseRgLine(JSON.stringify({ type: 'summary' }))).toBeNull()
    expect(parseRgLine(JSON.stringify({ type: 'match' }))).toBeNull()
    expect(parseRgLine(JSON.stringify({ type: 'match', data: {} }))).toBeNull()
    expect(parseRgLine(JSON.stringify({ type: 'match', data: { path: {} } }))).toBeNull()
    expect(parseRgLine(JSON.stringify({
      type: 'match', data: { path: { text: '/tmp/b.ts' }, lines: { text: 'text' }, submatches: [] }
    }))).toEqual({ file: '/tmp/b.ts', line: 0, column: 0, text: 'text' })
  })

  it('escapes regex syntax and reads nested configuration', () => {
    expect(escapeRegExp('a.*[b]')).toBe('a\\.\\*\\[b\\]')
    expect(getConfigValue('mcp.autoStart')).toBe(false)
    expect(getConfigValue('mcp.notFound')).toBeUndefined()
    expect(getConfigValue('mcp.notFound.child')).toBeUndefined()
    expect(getConfigValue('')).toBeTruthy()
  })

  it('runs ripgrep with case and glob options and stops at maxResults', async () => {
    expect(findRg()).toBeTruthy()
    let matches = await searchWithRg('HELLO', {
      caseSensitive: false,
      include: '**/*.ts',
      exclude: 'b.ts'
    }, tmpdir, 1)
    expect(matches).toHaveLength(1)
    expect(path.basename(matches[0].file)).toBe('a.ts')
    let exact = await searchWithRg('hello', { regex: true, caseSensitive: true }, tmpdir, 10)
    expect(exact.length).toBeGreaterThan(0)
  })

  it('workspace/files lists files by glob', async () => {
    let result = await tool('workspace/files').handler({ include: '**/*.ts' }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBe(2)
    let names = result.structuredContent.files.map((f: any) => path.basename(f.filepath)).sort()
    expect(names).toEqual(['a.ts', 'b.ts'])
  })

  it('workspace/search finds matches with line and column', async () => {
    let result = await tool('workspace/search').handler({
      pattern: 'hello',
      include: '**/*.ts',
      root: tmpdir
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.count).toBeGreaterThan(0)
    let match = result.structuredContent.matches.find((m: any) => path.basename(m.file) === 'a.ts')
    expect(match).toBeTruthy()
    expect(match.text).toContain('hello')
    expect(typeof match.line).toBe('number')
  })

  it('workspace/search supports regex mode and the JS fallback', async () => {
    let regexResult = await tool('workspace/search').handler({
      pattern: 'h.llo',
      regex: true,
      include: '**/*.ts',
      root: tmpdir
    }, { token })
    expect(regexResult.isError).toBeFalsy()
    expect(regexResult.structuredContent.count).toBeGreaterThan(0)
    let jsMatches = await searchWithJs('hello', { include: '**/*.ts' }, tmpdir, 100)
    expect(jsMatches.length).toBeGreaterThan(0)
    expect(jsMatches[0].text).toContain('hello')
  })

  it('workspace/search falls back when ripgrep is unavailable', async () => {
    let spy = vi.spyOn(which, 'sync').mockImplementation(() => { throw new Error('missing') })
    try {
      expect(findRg()).toBeNull()
      let result = await tool('workspace/search').handler({ pattern: 'hello', include: '**/*.ts', root: tmpdir }, { token })
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.engine).toBe('js')
    } finally {
      spy.mockRestore()
    }
  })

  it('workspace/search reports non-Error fallback failures', async () => {
    let whichSpy = vi.spyOn(which, 'sync').mockImplementation(() => { throw new Error('missing') })
    let filesSpy = vi.spyOn(workspace, 'findFiles').mockRejectedValueOnce('find failed')
    try {
      let result = await tool('workspace/search').handler({ pattern: 'hello', root: tmpdir }, { token })
      expect(result.content[0].text).toContain('find failed')
    } finally {
      whichSpy.mockRestore()
      filesSpy.mockRestore()
    }
  })

  it('workspace/configuration accepts an omitted key', async () => {
    let result = await tool('workspace/configuration').handler({}, { token })
    expect(result.structuredContent.key).toBe('')
    expect(result.structuredContent.value).toBeTruthy()
  })

  it('workspace/search filters files in deniedPaths and scopes to the root', async () => {
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
      expect(rgResult.isError).toBeFalsy()
      let rgFiles = rgResult.structuredContent.matches.map((m: any) => m.file)
      expect(rgFiles).toContain(path.join(keepDir, 'keep.ts'))
      expect(rgFiles.some(f => f.includes('denied-sub'))).toBe(false)
      let jsMatches = await searchWithJs('needle', { include: '**/*.ts' }, tmpdir, 100)
      let jsFiles = jsMatches.map(m => m.file)
      expect(jsFiles).toContain(path.join(keepDir, 'keep.ts'))
      expect(jsFiles.some(f => f.includes('denied-sub'))).toBe(false)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
    }
  })

  it('JS search fallback does not return files outside the requested root', async () => {
    let otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-other-'))
    fs.writeFileSync(path.join(otherDir, 'other.ts'), 'needle in other\n')
    workspace.workspaceFolderControl.addWorkspaceFolder(otherDir, true)
    try {
      let jsMatches = await searchWithJs('needle', { include: '**/*.ts' }, tmpdir, 100)
      expect(jsMatches.some(m => m.file.includes('other.ts'))).toBe(false)
    } finally {
      workspace.workspaceFolderControl.removeWorkspaceFolder(otherDir)
      fs.rmSync(otherDir, { recursive: true, force: true })
    }
  })

  it('JS search does not drop adjacent matching lines', async () => {
    let file = path.join(tmpdir, 'adjacent.txt')
    fs.writeFileSync(file, 'hello\nhello world\nworld\n')
    let matches = await searchWithJs('hello', { include: 'adjacent.txt' }, tmpdir, 100)
    let lines = matches.filter(m => m.file === file).map(m => m.line)
    expect(lines).toEqual([0, 1])
    let columns = matches.filter(m => m.file === file).map(m => m.column)
    expect(columns).toEqual([0, 0])
  })

  it('JS search handles empty-match regex without hanging', async () => {
    let file = path.join(tmpdir, 'empty-match.txt')
    fs.writeFileSync(file, 'abc\nxyz\n')
    let matches = await searchWithJs('x*', { regex: true, include: 'empty-match.txt' }, tmpdir, 100)
    // 'x*' matches once at index 0 of every line (including the trailing
    // empty line) without looping forever
    expect(matches.filter(m => m.file === file).map(m => m.line)).toEqual([0, 1, 2])
  })

  it('JS search handles defaults, case sensitivity, limits and skipped files', async () => {
    let binary = path.join(tmpdir, 'binary.dat')
    let large = path.join(tmpdir, 'large.dat')
    fs.writeFileSync(binary, 'hello\0world')
    fs.writeFileSync(large, 'hello' + 'x'.repeat(2 * 1024 * 1024))
    expect(await searchWithJs('HELLO', { caseSensitive: true }, tmpdir, 10)).toEqual([])
    let limited = await searchWithJs('hello', {}, tmpdir, 1)
    expect(limited).toHaveLength(1)
    await expect(searchWithJs('[', { regex: true }, tmpdir, 10)).rejects.toThrow('Invalid regex')
  })

  it('validates required arguments for workspace tools', async () => {
    for (let [name, args, message] of [
      ['workspace/search', {}, 'pattern is required'],
      ['workspace/files', {}, 'include glob is required'],
      ['workspace/apply_edit', {}, 'edit (WorkspaceEdit) is required'],
      ['workspace/create_file', {}, 'filepath is required'],
      ['workspace/rename_file', {}, 'oldPath and newPath are required'],
      ['workspace/delete_file', {}, 'filepath is required']
    ] as Array<[string, Record<string, unknown>, string]>) {
      let result = await tool(name).handler(args, { token })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(message)
    }
  })

  it('reports workspace operation failures', async () => {
    let createSpy = vi.spyOn(workspace, 'createFile').mockRejectedValue(new Error('create failed'))
    let renameSpy = vi.spyOn(workspace, 'renameFile').mockRejectedValue(new Error('rename failed'))
    let deleteSpy = vi.spyOn(workspace, 'deleteFile').mockRejectedValue(new Error('delete failed'))
    let applySpy = vi.spyOn(workspace, 'applyEdit').mockRejectedValue(new Error('apply failed'))
    try {
      let create = await tool('workspace/create_file').handler({ filepath: path.join(tmpdir, 'fail-create') }, { token })
      expect(create.content[0].text).toContain('create failed')
      let rename = await tool('workspace/rename_file').handler({
        oldPath: path.join(tmpdir, 'a.ts'),
        newPath: path.join(tmpdir, 'fail-rename')
      }, { token })
      expect(rename.content[0].text).toContain('rename failed')
      let remove = await tool('workspace/delete_file').handler({ filepath: path.join(tmpdir, 'a.ts') }, { token })
      expect(remove.content[0].text).toContain('delete failed')
      let apply = await tool('workspace/apply_edit').handler({ edit: { changes: {} } }, { token })
      expect(apply.content[0].text).toContain('apply failed')
    } finally {
      createSpy.mockRestore()
      renameSpy.mockRestore()
      deleteSpy.mockRestore()
      applySpy.mockRestore()
    }
  })

  it('reports non-Error workspace operation failures', async () => {
    let createSpy = vi.spyOn(workspace, 'createFile').mockRejectedValue('create string')
    let renameSpy = vi.spyOn(workspace, 'renameFile').mockRejectedValue('rename string')
    let deleteSpy = vi.spyOn(workspace, 'deleteFile').mockRejectedValue('delete string')
    let applySpy = vi.spyOn(workspace, 'applyEdit').mockRejectedValue('apply string')
    try {
      expect((await tool('workspace/create_file').handler({ filepath: path.join(tmpdir, 'fail-create') }, { token })).content[0].text).toContain('create string')
      expect((await tool('workspace/rename_file').handler({ oldPath: path.join(tmpdir, 'a.ts'), newPath: path.join(tmpdir, 'fail-rename') }, { token })).content[0].text).toContain('rename string')
      expect((await tool('workspace/delete_file').handler({ filepath: path.join(tmpdir, 'a.ts') }, { token })).content[0].text).toContain('delete string')
      expect((await tool('workspace/apply_edit').handler({ edit: { changes: {} } }, { token })).content[0].text).toContain('apply string')
    } finally {
      createSpy.mockRestore()
      renameSpy.mockRestore()
      deleteSpy.mockRestore()
      applySpy.mockRestore()
    }
  })

  it('workspace/create_file creates a file on disk and buffer', async () => {
    let filepath = path.join(tmpdir, 'created.txt')
    let result = await tool('workspace/create_file').handler({ filepath }, { token })
    expect(result.isError).toBeFalsy()
    expect(fs.existsSync(filepath)).toBe(true)
  })

  it('workspace/rename_file moves a file', async () => {
    let oldPath = path.join(tmpdir, 'created.txt')
    let newPath = path.join(tmpdir, 'renamed.txt')
    let result = await tool('workspace/rename_file').handler({ oldPath, newPath }, { token })
    expect(result.isError).toBeFalsy()
    expect(fs.existsSync(oldPath)).toBe(false)
    expect(fs.existsSync(newPath)).toBe(true)
  })

  it('workspace/delete_file removes a file', async () => {
    let filepath = path.join(tmpdir, 'renamed.txt')
    let result = await tool('workspace/delete_file').handler({ filepath }, { token })
    expect(result.isError).toBeFalsy()
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('workspace/apply_edit applies multi-file edits to buffers', async () => {
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
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.applied).toBe(true)
    expect(result.structuredContent.pendingSave).toBe(true)
    expect(result.structuredContent.saved).toBe(true)
    let dx = workspace.getDocument(ux)!
    expect(dx.textDocument.getText()).toContain('XX')
    let dy = workspace.getDocument(uy)!
    expect(dy.textDocument.getText()).toContain('YY')
    // the tool saves all modified buffers with :wa
    expect(commandSpy).toHaveBeenCalledWith('wa')
  })

  it('workspace/apply_edit reports saveError when :wa fails', async () => {
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
      expect(result.isError).toBeFalsy()
      expect(result.structuredContent.applied).toBe(true)
      expect(result.structuredContent.saved).toBe(false)
      expect(result.structuredContent.saveError).toBeTruthy()
      // the edit itself was applied to the buffer
      expect(workspace.getDocument(uz)!.textDocument.getText()).toContain('ZZ')
    } finally {
      rejectWa = false
    }
  })

  it('workspace/apply_edit carries optional WorkspaceEditMetadata', async () => {
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
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.applied).toBe(true)
    expect(result.structuredContent.metadata).toEqual({ isRefactoring: true })
  })

  it('workspace/apply_edit rejects invalid metadata', async () => {
    let x = path.join(tmpdir, 'meta-bad.txt')
    fs.writeFileSync(x, 'bad\n')
    let ux = URI.file(x).toString()
    let badType = await tool('workspace/apply_edit').handler({
      edit: { changes: { [ux]: [] } },
      metadata: 'not-an-object'
    }, { token })
    expect(badType.isError).toBe(true)
    let badField = await tool('workspace/apply_edit').handler({
      edit: { changes: { [ux]: [] } },
      metadata: { isRefactoring: 'yes' }
    }, { token })
    expect(badField.isError).toBe(true)
  })

  it('workspace/apply_edit supports create operations on disk', async () => {
    let created = path.join(tmpdir, 'apply-created.txt')
    let result = await tool('workspace/apply_edit').handler({
      edit: {
        documentChanges: [
          { kind: 'create', uri: URI.file(created).toString() }
        ]
      }
    }, { token })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent.applied).toBe(true)
    expect(fs.existsSync(created)).toBe(true)
  })

  it('workspace/apply_edit rejects rename when either side is outside allowed paths', async () => {
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
      expect(badTarget.isError).toBe(true)
      expect(fs.readFileSync(inside, 'utf8')).toBe('inside\n')
      expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n')
      // source outside the allowed workspace
      let badSource = await tool('workspace/apply_edit').handler({
        edit: {
          documentChanges: [{ kind: 'rename', oldUri: outsideUri, newUri: insideUri }]
        }
      }, { token })
      expect(badSource.isError).toBe(true)
      expect(fs.readFileSync(inside, 'utf8')).toBe('inside\n')
      expect(fs.readFileSync(outside, 'utf8')).toBe('outside\n')
      // both sides inside the workspace still works
      let moved = path.join(tmpdir, 'rename-moved.txt')
      let ok = await tool('workspace/apply_edit').handler({
        edit: {
          documentChanges: [{ kind: 'rename', oldUri: insideUri, newUri: URI.file(moved).toString() }]
        }
      }, { token })
      expect(ok.isError).toBeFalsy()
      expect(ok.structuredContent.applied).toBe(true)
      expect(fs.existsSync(inside)).toBe(false)
      expect(fs.existsSync(moved)).toBe(true)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('rejects file operations matching mcp.deniedPaths', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.deniedPaths': [path.join(tmpdir, 'secret*')] })
    let filepath = path.join(tmpdir, 'secret.txt')
    let result = await tool('workspace/create_file').handler({ filepath }, { token })
    expect(result.isError).toBe(true)
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('rejects write tools that reach outside the workspace through symlinks', async () => {
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
      expect(create.isError).toBe(true)
      expect(fs.existsSync(path.join(outsideDir, 'new.txt'))).toBe(false)
      let rename = await tool('workspace/rename_file').handler({
        oldPath: path.join(link, 'target.txt'),
        newPath: path.join(tmpdir, 'stolen.txt')
      }, { token })
      expect(rename.isError).toBe(true)
      expect(fs.existsSync(outsideFile)).toBe(true)
      expect(fs.existsSync(path.join(tmpdir, 'stolen.txt'))).toBe(false)
      let del = await tool('workspace/delete_file').handler({ filepath: path.join(link, 'target.txt') }, { token })
      expect(del.isError).toBe(true)
      expect(fs.existsSync(outsideFile)).toBe(true)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })
})
