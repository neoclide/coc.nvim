'use strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import events from '../../events'
import { gracefulExit, setExitHook } from '../../exit'
import { getInstanceFilePath, readDiscoveryFile } from '../../mcp/auth'
import mcp from '../../mcp'
import { McpServer } from '../../mcp/server'
import workspace from '../../workspace'
import { TestClient } from './testClient'

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
    expect(mcp.running).toBe(true)
    let status = mcp.status()
    expect(status.running).toBe(true)
    expect(status.transport).toBe(process.platform === 'win32' ? 'tcp' : 'unix')
    if (status.transport === 'tcp') {
      expect(status.port).toBeGreaterThan(0)
    } else {
      expect(status.socketPath).toBeTruthy()
    }
    expect(status.tools).toEqual(expect.arrayContaining(['workspace/info', 'workspace/configuration']))
    let instancePath = await waitForInstanceFile()
    let info = readDiscoveryFile(instancePath)
    expect(info).not.toBeNull()
    expect(info!.token.length).toBe(64)
    if (status.transport === 'tcp') {
      expect(info!.port).toBe(status.port)
    } else {
      expect(info!.socketPath).toBe(status.socketPath)
    }
    expect(info!.cwd).toBeTruthy()
    expect(info!.workspaceRoot).toBeTruthy()
    expect(status.pid).toBe(process.pid)
    expect(status.cwd).toBeTruthy()
    expect(Array.isArray(status.clients)).toBe(true)
  })

  it('removes the per-instance discovery file and stops listening on stop', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true })
    await mcp.start()
    // The instance file is published as part of the start flow; poll briefly
    // so the assertion is not racing the file write.
    let instancePath = await waitForInstanceFile()
    expect(fs.existsSync(instancePath)).toBe(true)
    let socketPath = mcp.status().socketPath as string | undefined
    mcp.stop()
    expect(mcp.running).toBe(false)
    expect(fs.existsSync(instancePath)).toBe(false)
    if (socketPath) {
      expect(fs.existsSync(socketPath)).toBe(false)
    }
  })

  it('does nothing when disabled', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': false })
    await mcp.start()
    expect(mcp.running).toBe(false)
    expect(fs.existsSync(getInstanceFilePath(process.pid))).toBe(false)
  })

  it('starts even when disabled when forced', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': false })
    await mcp.start(true)
    expect(mcp.running).toBe(true)
    let instancePath = await waitForInstanceFile()
    expect(fs.existsSync(instancePath)).toBe(true)
  })

  it('handles a server listen failure without publishing the service', async () => {
    let listenSpy = vi.spyOn(McpServer.prototype, 'listen').mockRejectedValue(new Error('listen failed'))
    let disposeSpy = vi.spyOn(McpServer.prototype, 'dispose')
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.transport': 'tcp' })
    try {
      await mcp.start()
      expect(mcp.running).toBe(false)
      expect(disposeSpy).toHaveBeenCalled()
      expect(fs.existsSync(getInstanceFilePath(process.pid))).toBe(false)
    } finally {
      listenSpy.mockRestore()
      disposeSpy.mockRestore()
    }
  })

  it('serializes concurrent starts into a single server', async () => {
    let releaseListen: () => void = () => {}
    let listenSpy = vi.spyOn(McpServer.prototype, 'listen').mockImplementation(() => new Promise(resolve => {
      releaseListen = () => resolve({ host: '127.0.0.1', port: 0, socketPath: '' } as any)
    }))
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': [] })
    try {
      let first = mcp.start()
      let second = mcp.start()
      expect(listenSpy).toHaveBeenCalledTimes(1)
      releaseListen()
      await Promise.all([first, second])
      expect(mcp.running).toBe(true)
    } finally {
      listenSpy.mockRestore()
      mcp.stop()
    }
  })

  it('stop during start disposes the pending server and publishes nothing', async () => {
    let releaseListen: () => void = () => {}
    let listenSpy = vi.spyOn(McpServer.prototype, 'listen').mockImplementation(() => new Promise(resolve => {
      releaseListen = () => resolve({ host: '127.0.0.1', port: 0, socketPath: '' } as any)
    }))
    let disposeSpy = vi.spyOn(McpServer.prototype, 'dispose')
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': [] })
    try {
      let pending = mcp.start()
      mcp.stop()
      releaseListen()
      await pending
      expect(mcp.running).toBe(false)
      expect(disposeSpy).toHaveBeenCalled()
      expect(fs.existsSync(getInstanceFilePath(process.pid))).toBe(false)
    } finally {
      listenSpy.mockRestore()
      disposeSpy.mockRestore()
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
      expect(lines[0]).toBe('MCP server: running')
      expect(lines.join('\n')).toContain('transport:')
      expect(lines.join('\n')).toContain('cwd:')
      expect(lines.join('\n')).toContain('clients: 1')
      expect(lines.join('\n')).toContain('status-client')
      expect(lines.join('\n')).toContain('tools:')
      expect(lines.join('\n')).toContain('    document/read')
      expect(lines.join('\n')).toContain('    lsp/references')
    } finally {
      client.close()
      mcp.stop()
    }
    expect(mcp.getStatusLines()).toEqual(['MCP server: not running'])
  })

  it('stops the MCP service on VimLeavePre', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true })
    await mcp.start()
    expect(mcp.running).toBe(true)
    await events.fire('VimLeavePre', [])
    expect(mcp.running).toBe(false)
    expect(fs.existsSync(getInstanceFilePath(process.pid))).toBe(false)
  })

  it('stops the MCP service on termination signals', () => {
    let spy = vi.spyOn(mcp, 'stop')
    setExitHook((code: number): never => {
      // prevent the test process from exiting
      process.exitCode = code
      return undefined as never
    })
    try {
      gracefulExit('SIGTERM')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
      // keep the no-op exit hook installed: gracefulExit's async tail calls
      // exitFn after this test finishes, and vitest's process.exit throws
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
    expect(mcp.status().tools).toContain('extension/hello')
    disposable.dispose()
    expect(mcp.status().tools).not.toContain('extension/hello')
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
    expect(mcp.status().tools).toContain('extension/live')
    disposable.dispose()
    expect(mcp.status().tools).not.toContain('extension/live')
  })

  it('throws on duplicate extension tool names', () => {
    let disposable = mcp.registerTool({
      name: 'extension/dup',
      description: 'extension tool',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    expect(() => mcp.registerTool({
      name: 'extension/dup',
      description: 'extension tool 2',
      inputSchema: { type: 'object', properties: {} },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })).toThrow(/already registered/)
    disposable.dispose()
  })

  it('rejects extension tools without a name', () => {
    expect(() => mcp.registerTool({
      name: '',
      description: 'missing name',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [] })
    })).toThrow('Tool name is required')
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
    expect(mcp.status().tools).toContain('extension/persist')
    mcp.stop()
    await mcp.start()
    expect(mcp.status().tools).toContain('extension/persist')
    disposable.dispose()
  })
})
