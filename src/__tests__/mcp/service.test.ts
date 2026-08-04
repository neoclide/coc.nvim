'use strict'
import fs from 'fs'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import events from '../../events'
import { gracefulExit, setExitHook } from '../../exit'
import { getInstanceFilePath, readDiscoveryFile } from '../../mcp/auth'
import mcp from '../../mcp'
import workspace from '../../workspace'

describe('mcp service', () => {
  afterEach(() => {
    mcp.stop()
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': false, 'mcp.allowedTools': [] })
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
    let instancePath = getInstanceFilePath(process.pid)
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
    let instancePath = getInstanceFilePath(process.pid)
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
    expect(fs.existsSync(getInstanceFilePath(process.pid))).toBe(true)
  })

  it('formats human-readable status lines', async () => {
    workspace.configurations.updateMemoryConfig({ 'mcp.autoStart': true, 'mcp.allowedTools': ['document/read', 'lsp/references'] })
    await mcp.start()
    let lines = mcp.getStatusLines()
    expect(lines[0]).toBe('MCP server: running')
    expect(lines.join('\n')).toContain('transport:')
    expect(lines.join('\n')).toContain('cwd:')
    expect(lines.join('\n')).toContain('clients:')
    expect(lines.join('\n')).toContain('tools:')
    expect(lines.join('\n')).toContain('    document/read')
    expect(lines.join('\n')).toContain('    lsp/references')
    mcp.stop()
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
