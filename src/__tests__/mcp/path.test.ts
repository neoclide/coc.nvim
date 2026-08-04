'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkPath } from '../../mcp/tools/util'
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
  it('allows files inside the workspace root by default', () => {
    expect(checkPath(path.join(process.cwd(), 'package.json'))).toBeNull()
  })

  it('denies files outside the workspace when not opened', () => {
    expect(checkPath('/etc/passwd')).not.toBeNull()
  })

  it('allows temporary directory reads but denies writes by default', () => {
    let file = path.join(os.tmpdir(), 'coc-mcp-tmp-read.txt')
    expect(checkPath(file)).toBeNull()
    expect(checkPath(file, { write: true })).not.toBeNull()
  })

  it('allows paths matching mcp.allowedPaths for writes', () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [path.join(tmpdir, '**')] })
    expect(checkPath(path.join(allowedDir, 'a.txt'), { write: true })).toBeNull()
  })

  it('allows directory roots matching trailing /** globs', () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.allowedPaths': [path.join(tmpdir, '**')] })
    expect(checkPath(tmpdir)).toBeNull()
    expect(checkPath(allowedDir)).toBeNull()
  })

  it('applies mcp.deniedPaths before mcp.allowedPaths', () => {
    workspace.configurations.updateMemoryConfig({
      'mcp.allowedPaths': [path.join(tmpdir, '**')],
      'mcp.deniedPaths': [path.join(allowedDir, 'secret*')]
    })
    expect(checkPath(path.join(allowedDir, 'secret.txt'))).not.toBeNull()
    expect(checkPath(path.join(allowedDir, 'ok.txt'))).toBeNull()
  })
})
