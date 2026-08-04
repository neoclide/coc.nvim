'use strict'
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../mcp/tools'
import { createWorkspaceTools } from '../../mcp/tools/workspace'
import { CancellationToken } from '../../util/protocol'

describe('mcp workspace tools', () => {
  it('workspace/info returns editor state without a running nvim', async () => {
    let tools = createWorkspaceTools()
    let info = tools.find(t => t.name === 'workspace/info')!
    let result = await info.handler({}, { token: CancellationToken.None })
    expect(result.structuredContent.version).toBeTruthy()
    expect(result.structuredContent.cwd).toBeTruthy()
    expect(Array.isArray(result.structuredContent.services)).toBe(true)
    expect(result.content[0].type).toBe('text')
  })

  it('workspace/configuration reads defaults from the schema', async () => {
    let tools = createWorkspaceTools()
    let tool = tools.find(t => t.name === 'workspace/configuration')!
    let result = await tool.handler({ key: 'mcp.enabled' }, { token: CancellationToken.None })
    expect(result.structuredContent.key).toBe('mcp.enabled')
    expect(result.structuredContent.value).toBe(false)
    expect(result.structuredContent.inspect).toBeTruthy()
  })

  it('workspace/configuration returns undefined for unknown keys', async () => {
    let tools = createWorkspaceTools()
    let tool = tools.find(t => t.name === 'workspace/configuration')!
    let result = await tool.handler({ key: 'mcp.notARealKey' }, { token: CancellationToken.None })
    expect(result.structuredContent.value).toBeUndefined()
  })
})

describe('mcp ToolRegistry whitelist', () => {
  function sampleRegistry(): ToolRegistry {
    let registry = new ToolRegistry()
    registry.register({
      name: 'a',
      description: 'tool a',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'a' }] })
    })
    registry.register({
      name: 'b',
      description: 'tool b',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'b' }] })
    })
    return registry
  }

  it('allows every tool by default', () => {
    let registry = sampleRegistry()
    expect(registry.list().tools.map(t => t.name)).toEqual(['a', 'b'])
    expect(registry.has('a')).toBe(true)
    expect(registry.get('b')).toBeDefined()
  })

  it('hides tools outside the whitelist', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    expect(registry.list().tools.map(t => t.name)).toEqual(['a'])
    expect(registry.has('a')).toBe(true)
    expect(registry.has('b')).toBe(false)
    expect(registry.get('b')).toBeUndefined()
  })

  it('exposes no tools when the whitelist is empty', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools([])
    expect(registry.list().tools).toEqual([])
    expect(registry.has('a')).toBe(false)
    expect(registry.isAllowed('a')).toBe(false)
  })

  it('rejects calls to blocked tools', async () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    await expect(registry.call('b', {}, { token: CancellationToken.None })).rejects.toThrow(/Unknown tool/)
    let result = await registry.call('a', {}, { token: CancellationToken.None })
    expect(result.content[0].text).toBe('a')
  })

  it('restores full access with a null whitelist', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    registry.setAllowedTools(null)
    expect(registry.list().tools.map(t => t.name)).toEqual(['a', 'b'])
  })
})
