'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import events from '../../events'
import { gracefulExit, setExitHook } from '../../exit'
import { getInstanceFilePath, readDiscoveryFile } from '../../mcp/auth'
import mcp from '../../mcp'
import { McpServer } from '../../mcp/server'
import workspace from '../../workspace'
import { TestClient } from '../mcp/testClient'

// no-isolate worker threads share one process pid and the default COC_MCP_DIR,
// so a concurrent mcp.stop() in a sibling test (e.g. exit.test) can delete the
// per-instance discovery file this file is polling. Use a dedicated directory
// to make the assertions deterministic regardless of what runs in parallel.
const mcpDir = path.join(os.tmpdir(), `coc-mcp-service-${process.pid}`)
process.env.COC_MCP_DIR = mcpDir

describe('mcp service', () => {
  async function waitForInstanceFile(timeout = 2000): Promise<string> {
    let instancePath = getInstanceFilePath(process.pid)
    let deadline = Date.now() + timeout
    while (!fs.existsSync(instancePath)) {
      if (Date.now() >= deadline) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    return instancePath
  }

  afterEach(() => {
    mcp.stop()
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': false, 'mcp.allowedTools': [], 'mcp.transport': 'auto' })
  })

  afterAll(() => {
    fs.rmSync(mcpDir, { recursive: true, force: true })
  })

  it('starts the socket server and writes the per-instance discovery file', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': ['workspace/info', 'workspace/configuration'] })
    await mcp.start()
    assert.strictEqual(mcp.running, true)
    let status = mcp.status()
    assert.strictEqual(status.running, true)
    assert.strictEqual(status.transport, process.platform === 'win32' ? 'tcp' : 'unix')
    if (status.transport === 'tcp') {
      assert.ok((status.port) > (0))
    } else {
      assert.ok(status.socketPath)
    }
    assert.ok(['workspace/info', 'workspace/configuration'].every(name => status.tools.includes(name)))
    let instancePath = await waitForInstanceFile()
    let info = readDiscoveryFile(instancePath)
    assert.notStrictEqual(info, null)
    assert.strictEqual(info!.token.length, 64)
    if (status.transport === 'tcp') {
      assert.strictEqual(info!.port, status.port)
    } else {
      assert.strictEqual(info!.socketPath, status.socketPath)
    }
    assert.ok(info!.cwd)
    assert.ok(info!.workspaceRoot)
    assert.strictEqual(status.pid, process.pid)
    assert.ok(status.cwd)
    assert.strictEqual(Array.isArray(status.clients), true)
  })

  it('removes the per-instance discovery file and stops listening on stop', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true })
    await mcp.start()
    // The instance file is published as part of the start flow; poll briefly
    // so the assertion is not racing the file write.
    let instancePath = await waitForInstanceFile()
    assert.strictEqual(fs.existsSync(instancePath), true)
    let socketPath = mcp.status().socketPath as string | undefined
    mcp.stop()
    assert.strictEqual(mcp.running, false)
    assert.strictEqual(fs.existsSync(instancePath), false)
    if (socketPath) {
      assert.strictEqual(fs.existsSync(socketPath), false)
    }
  })

  it('does nothing when disabled', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': false })
    await mcp.start()
    assert.strictEqual(mcp.running, false)
    assert.strictEqual(fs.existsSync(getInstanceFilePath(process.pid)), false)
  })

  it('starts even when disabled when forced', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': false })
    await mcp.start(true)
    assert.strictEqual(mcp.running, true)
    let instancePath = await waitForInstanceFile()
    assert.strictEqual(fs.existsSync(instancePath), true)
  })

  it('handles a server listen failure without publishing the service', async (t) => {
    let listenSpy = t.mock.method(McpServer.prototype, 'listen', () => Promise.reject(new Error('listen failed')))
    let disposeSpy = t.mock.method(McpServer.prototype, 'dispose')
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.transport': 'tcp' })
    try {
      await mcp.start()
      assert.strictEqual(mcp.running, false)
      assert.ok((disposeSpy).mock.callCount() > 0)
      assert.strictEqual(fs.existsSync(getInstanceFilePath(process.pid)), false)
    } finally {
      listenSpy.mock.restore()
      disposeSpy.mock.restore()
    }
  })

  it('serializes concurrent starts into a single server', async (t) => {
    let releaseListen: () => void = () => {}
    let listenSpy = t.mock.method(McpServer.prototype, 'listen', () => new Promise(resolve => {
      releaseListen = () => resolve({ host: '127.0.0.1', port: 0, socketPath: '' } as any)
    }))
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': [] })
    try {
      let first = mcp.start()
      let second = mcp.start()
      assert.strictEqual((listenSpy).mock.callCount(), 1)
      releaseListen()
      await Promise.all([first, second])
      assert.strictEqual(mcp.running, true)
    } finally {
      listenSpy.mock.restore()
      mcp.stop()
    }
  })

  it('stop during start disposes the pending server and publishes nothing', async (t) => {
    let releaseListen: () => void = () => {}
    let listenSpy = t.mock.method(McpServer.prototype, 'listen', () => new Promise(resolve => {
      releaseListen = () => resolve({ host: '127.0.0.1', port: 0, socketPath: '' } as any)
    }))
    let disposeSpy = t.mock.method(McpServer.prototype, 'dispose')
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': [] })
    try {
      let pending = mcp.start()
      mcp.stop()
      releaseListen()
      await pending
      assert.strictEqual(mcp.running, false)
      assert.ok((disposeSpy).mock.callCount() > 0)
      assert.strictEqual(fs.existsSync(getInstanceFilePath(process.pid)), false)
    } finally {
      listenSpy.mock.restore()
      disposeSpy.mock.restore()
      mcp.stop()
    }
  })

  it('formats human-readable status lines', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': ['document/read', 'lsp/references'] })
    await mcp.start()
    let info = readDiscoveryFile(await waitForInstanceFile())!
    let client = new TestClient(info.transport === 'tcp' ? info.port! : info.socketPath!)
    try {
      await client.request(0, 'coc/auth', { token: info.token, clientInfo: { name: 'status-client', version: '1' } })
      await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
      let lines = mcp.getStatusLines()
      assert.strictEqual(lines[0], 'MCP server: running')
      assert.ok((lines.join('\n')).includes('transport:'))
      assert.ok((lines.join('\n')).includes('cwd:'))
      assert.ok((lines.join('\n')).includes('clients: 1'))
      assert.ok((lines.join('\n')).includes('status-client'))
      assert.ok((lines.join('\n')).includes('tools:'))
      assert.ok((lines.join('\n')).includes('    document/read'))
      assert.ok((lines.join('\n')).includes('    lsp/references'))
    } finally {
      client.close()
      mcp.stop()
    }
    assert.deepStrictEqual(mcp.getStatusLines(), ['MCP server: not running'])
  })

  it('stops the MCP service on VimLeavePre', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true })
    await mcp.start()
    assert.strictEqual(mcp.running, true)
    await events.fire('VimLeavePre', [])
    assert.strictEqual(mcp.running, false)
    assert.strictEqual(fs.existsSync(getInstanceFilePath(process.pid)), false)
  })

  it('stops the MCP service on termination signals', (t) => {
    let spy = t.mock.method(mcp, 'stop')
    setExitHook((code: number): never => {
      // prevent the test process from exiting
      process.exitCode = code
      return undefined as never
    })
    try {
      gracefulExit('SIGTERM')
      assert.ok((spy).mock.callCount() > 0)
    } finally {
      spy.mock.restore()
      // keep the no-op exit hook installed: gracefulExit's async tail calls
      // exitFn after this test finishes, so restoring the default would exit
    }
  })

  it('registers a custom extension tool visible in tools/list', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': ['extension/hello'] })
    let disposable = mcp.registerTool({
      name: 'extension/hello',
      description: 'extension tool',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    await mcp.start()
    assert.ok((mcp.status().tools).includes('extension/hello'))
    disposable.dispose()
    assert.ok(!(mcp.status().tools).includes('extension/hello'))
  })

  it('registers a tool while running and unregisters on dispose', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': ['extension/live'] })
    await mcp.start()
    let disposable = mcp.registerTool({
      name: 'extension/live',
      description: 'extension tool',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    assert.ok((mcp.status().tools).includes('extension/live'))
    disposable.dispose()
    assert.ok(!(mcp.status().tools).includes('extension/live'))
  })

  it('throws on duplicate extension tool names', () => {
    let disposable = mcp.registerTool({
      name: 'extension/dup',
      description: 'extension tool',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    assert.throws(() => mcp.registerTool({
      name: 'extension/dup',
      description: 'extension tool 2',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    }), /already registered/)
    disposable.dispose()
  })

  it('rejects extension tools without a name', () => {
    assert.throws(() => mcp.registerTool({
      name: '',
      description: 'missing name',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [] })
    }), error => String(error instanceof Error ? error.message : error).includes('Tool name is required'))
  })

  it('keeps extension tools across server restarts', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': ['extension/persist'] })
    let disposable = mcp.registerTool({
      name: 'extension/persist',
      description: 'extension tool',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    await mcp.start()
    assert.ok((mcp.status().tools).includes('extension/persist'))
    mcp.stop()
    await mcp.start()
    assert.ok((mcp.status().tools).includes('extension/persist'))
    disposable.dispose()
  })
})
