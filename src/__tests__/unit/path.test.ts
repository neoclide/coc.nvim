'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { checkPath, collectEditUris, errorResult, folderPaths, globMatch, globVariants, textResult, toFsPath, toUri } from '../../mcp/tools/util'
import workspace from '../../workspace'

let tmpdir: string
let allowedDir: string

beforeAll(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-path-'))
  allowedDir = path.join(tmpdir, 'allowed')
  fs.mkdirSync(allowedDir, { recursive: true })
  workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
})

afterAll(() => {
  workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

describe('mcp path validation', () => {
  it('constructs results and normalizes paths', () => {
    assert.deepStrictEqual(textResult('text'), { content: [{ type: 'text', text: 'text' }] })
    assert.strictEqual(textResult('text', null).structuredContent, null)
    assert.strictEqual(errorResult('bad').isError, true)
    let uri = toUri(path.join(tmpdir, 'file.txt'))
    assert.match(uri, /^file:/)
    assert.strictEqual(toUri('untitled://one'), 'untitled://one')
    assert.strictEqual(toFsPath(uri), path.join(tmpdir, 'file.txt'))
  })

  it('collects every WorkspaceEdit URI form', () => {
    assert.deepStrictEqual(collectEditUris({
      changes: { 'file:///a': [] },
      documentChanges: [
        null,
        { textDocument: { uri: 'file:///b' } },
        { uri: 'file:///c' },
        { oldUri: 'file:///d', newUri: 'file:///e' },
        { textDocument: { uri: 1 }, uri: 1 }
      ]
    }), ['file:///a', 'file:///b', 'file:///c', 'file:///d', 'file:///e'])
    assert.deepStrictEqual(collectEditUris(null), [])
    assert.deepStrictEqual(collectEditUris({ changes: null, documentChanges: {} }), [])
  })

  it('matches glob variants for files, directories and missing paths', () => {
    let file = path.join(allowedDir, 'file.txt')
    fs.writeFileSync(file, 'x')
    assert.strictEqual(globMatch(path.join(tmpdir, '**'), file), true)
    assert.strictEqual(globMatch(path.join(tmpdir, '**'), tmpdir), true)
    assert.strictEqual(globMatch(path.join(tmpdir, 'missing*'), path.join(tmpdir, 'missing.txt')), true)
    assert.strictEqual(globMatch('package.json', path.join(process.cwd(), 'package.json')), true)
    assert.deepStrictEqual(globVariants('relative/**'), ['relative/**'])
    assert.strictEqual(globVariants(file)[0], file)
    assert.deepStrictEqual(folderPaths(), workspace.folderPaths)
  })

  it('allows files inside the workspace root by default', () => {
    assert.strictEqual(checkPath(path.join(process.cwd(), 'package.json')), null)
  })

  it('denies files outside the workspace when not opened', () => {
    assert.notStrictEqual(checkPath('/etc/passwd'), null)
  })

  it('allows temporary directory reads but denies writes by default', () => {
    let file = path.join(os.tmpdir(), 'coc-mcp-tmp-read.txt')
    assert.strictEqual(checkPath(file), null)
    assert.notStrictEqual(checkPath(file, { write: true }), null)
  })

  it('allows paths matching mcp.allowedPaths for writes', () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [path.join(tmpdir, '**')] })
    assert.strictEqual(checkPath(path.join(allowedDir, 'a.txt'), { write: true }), null)
  })

  it('allows directory roots matching trailing /** globs', () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [path.join(tmpdir, '**')] })
    assert.strictEqual(checkPath(tmpdir), null)
    assert.strictEqual(checkPath(allowedDir), null)
  })

  it('applies mcp.deniedPaths before mcp.allowedPaths', () => {
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**')],
      'mcp.deniedPaths': [path.join(allowedDir, 'secret*')]
    })
    assert.notStrictEqual(checkPath(path.join(allowedDir, 'secret.txt')), null)
    assert.strictEqual(checkPath(path.join(allowedDir, 'ok.txt')), null)
  })

  it('denies symlink paths that escape the workspace boundary', () => {
    let outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-out-'))
    let link = path.join(tmpdir, 'escape-link')
    try {
      fs.symlinkSync(outside, link)
    } catch (_e) {
      fs.rmSync(outside, { recursive: true, force: true })
      return // platform without symlink privilege
    }
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**')],
      'mcp.deniedPaths': []
    })
    try {
      let throughLink = path.join(link, 'secret.txt')
      assert.notStrictEqual(checkPath(throughLink), null)
      assert.notStrictEqual(checkPath(throughLink, { write: true }), null)
      assert.notStrictEqual(checkPath(path.join(outside, 'secret.txt')), null)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('requires both lexical and canonical paths to be allowed', () => {
    let outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-out-'))
    let link = path.join(tmpdir, 'escape-allowed')
    try {
      fs.symlinkSync(outside, link)
    } catch (_e) {
      fs.rmSync(outside, { recursive: true, force: true })
      return // platform without symlink privilege
    }
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**'), path.join(outside, '**')],
      'mcp.deniedPaths': []
    })
    try {
      let throughLink = path.join(link, 'secret.txt')
      assert.strictEqual(checkPath(throughLink), null)
      workspace.configurations.updateMemoryConfig({
        'mcp.allowedPaths': [path.join(tmpdir, '**'), path.join(outside, '**')],
        'mcp.deniedPaths': [path.join(outside, 'secret*')]
      })
      assert.notStrictEqual(checkPath(throughLink), null)
      assert.strictEqual(checkPath(path.join(outside, 'ok.txt')), null)
    } finally {
      workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [], 'mcp.deniedPaths': [] })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})
