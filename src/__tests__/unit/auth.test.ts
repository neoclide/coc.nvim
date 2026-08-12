'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  createDiscoveryInfo,
  generateToken,
  getMcpDir,
  getInstanceFilePath,
  listInstances,
  readDiscoveryFile,
  removeInstanceFile,
  removeSocketFile,
  writeInstanceFile
} from '../../mcp/auth'
import type { DiscoveryInfo } from '../../mcp/auth'

let dir: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-auth-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('mcp auth', () => {
  it('uses COC_MCP_DIR when configured', () => {
    let previous = process.env.COC_MCP_DIR
    process.env.COC_MCP_DIR = dir
    try {
      assert.strictEqual(getMcpDir(), dir)
      delete process.env.COC_MCP_DIR
      assert.ok((getMcpDir()).includes(path.join('.coc', 'mcp')))
    } finally {
      if (previous === undefined) delete process.env.COC_MCP_DIR
      else process.env.COC_MCP_DIR = previous
    }
  })

  it('should generate a 64 char hex token', () => {
    let token = generateToken()
    assert.match(token, /^[0-9a-f]{64}$/)
    assert.notStrictEqual(token, generateToken())
  })

  it('should support unix socket discovery info', () => {
    let info = createDiscoveryInfo({
      transport: 'unix',
      socketPath: '/tmp/coc-mcp-test.sock',
      token: 'token-2',
      pid: process.pid
    })
    assert.strictEqual(info.socketPath, '/tmp/coc-mcp-test.sock')
    assert.strictEqual(info.port, undefined)
  })

  it('should write, list and remove per-instance files with cwd info', () => {
    let info = createDiscoveryInfo({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 23456,
      token: 'token-instance',
      pid: process.pid,
      cwd: '/tmp/project-a',
      workspaceRoot: '/tmp/project-a'
    })
    writeInstanceFile(info, dir)
    let file = getInstanceFilePath(info.pid, dir)
    assert.strictEqual(fs.existsSync(file), true)
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600)
    }
    let instances = listInstances(dir)
    assert.strictEqual(instances.length, 1)
    assert.strictEqual(instances[0].cwd, '/tmp/project-a')
    assert.strictEqual(instances[0].workspaceRoot, '/tmp/project-a')
    removeInstanceFile(info.pid, dir)
    assert.strictEqual(fs.existsSync(file), false)
  })

  it('should ignore stale instance files whose process is dead', () => {
    let stale: DiscoveryInfo = {
      version: 1,
      pid: 999999999,
      transport: 'tcp',
      host: '127.0.0.1',
      port: 1,
      token: 'stale',
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'coc.nvim', version: '0.0.0' },
      apiVersion: 38
    }
    writeInstanceFile(stale, dir)
    assert.strictEqual(listInstances(dir).length, 0)
  })

  it('should return null for invalid discovery files', () => {
    let file = path.join(dir, 'discovery.json')
    fs.writeFileSync(file, '{invalid json')
    assert.strictEqual(readDiscoveryFile(file), null)
    fs.writeFileSync(file, JSON.stringify({ version: 2, pid: 1, token: 'x' }))
    assert.strictEqual(readDiscoveryFile(file), null)
    fs.writeFileSync(file, JSON.stringify({ version: 1, pid: 'a', token: 'x' }))
    assert.strictEqual(readDiscoveryFile(file), null)
    for (let value of [
      { version: 1, pid: 1, token: '', transport: 'tcp', host: 'x', port: 1 },
      { version: 1, pid: 1, token: 'x', transport: 'invalid' },
      { version: 1, pid: 1, token: 'x', transport: 'tcp', port: 1 },
      { version: 1, pid: 1, token: 'x', transport: 'tcp', host: 'x' },
      { version: 1, pid: 1, token: 'x', transport: 'unix' }
    ]) {
      fs.writeFileSync(file, JSON.stringify(value))
      assert.strictEqual(readDiscoveryFile(file), null)
    }
    assert.strictEqual(readDiscoveryFile(path.join(dir, 'missing.json')), null)
  })

  it('ignores unrelated instance files and missing cleanup targets', () => {
    fs.writeFileSync(path.join(dir, 'unrelated.json'), '{}')
    assert.deepStrictEqual(listInstances(dir), [])
    assert.doesNotThrow(() => removeInstanceFile(999999, dir))
    assert.doesNotThrow(() => removeSocketFile(path.join(dir, 'missing.sock')))
  })

  it('should return no instances when the MCP directory does not exist', () => {
    assert.deepStrictEqual(listInstances(path.join(dir, 'missing-directory')), [])
  })

  it('should ignore instance file write errors', () => {
    let notDirectory = path.join(dir, 'not-a-directory')
    fs.writeFileSync(notDirectory, 'file')
    let info = createDiscoveryInfo({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 1234,
      token: 'token',
      pid: process.pid
    })
    assert.doesNotThrow(() => writeInstanceFile(info, notDirectory))
    assert.strictEqual(fs.existsSync(getInstanceFilePath(process.pid, notDirectory)), false)
  })
})
