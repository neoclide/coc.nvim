'use strict'
import { ToolRegistry } from '../../mcp/tools'
import { createWorkspaceTools } from '../../mcp/tools/workspace'
import { CancellationToken } from '../../util/protocol'

describe('mcp workspace tools', () => {
  it('workspace/info returns editor state without a running nvim', async () => {
    let tools = createWorkspaceTools()
    let info = tools.find(t => t.name === 'workspace/info')!
    let result = await info.handler({}, { token: CancellationToken.None })
    assert.ok(result.structuredContent.version)
    assert.ok(result.structuredContent.cwd)
    assert.strictEqual(Array.isArray(result.structuredContent.services), true)
    assert.strictEqual(result.content[0].type, 'text')
  })

  it('workspace/configuration reads defaults from the schema', async () => {
    let tools = createWorkspaceTools()
    let tool = tools.find(t => t.name === 'workspace/configuration')!
    let result = await tool.handler({ key: 'mcp.autoStart' }, { token: CancellationToken.None })
    assert.strictEqual(result.structuredContent.key, 'mcp.autoStart')
    assert.strictEqual(result.structuredContent.value, false)
    assert.ok(result.structuredContent.inspect)
  })

  it('workspace/configuration returns undefined for unknown keys', async () => {
    let tools = createWorkspaceTools()
    let tool = tools.find(t => t.name === 'workspace/configuration')!
    let result = await tool.handler({ key: 'mcp.notARealKey' }, { token: CancellationToken.None })
    assert.strictEqual(result.structuredContent.value, undefined)
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
    assert.deepStrictEqual(registry.list().tools.map(t => t.name), ['a', 'b'])
    assert.strictEqual(registry.has('a'), true)
    assert.notStrictEqual(registry.get('b'), undefined)
  })

  it('hides tools outside the whitelist', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    assert.deepStrictEqual(registry.list().tools.map(t => t.name), ['a'])
    assert.strictEqual(registry.has('a'), true)
    assert.strictEqual(registry.has('b'), false)
    assert.strictEqual(registry.get('b'), undefined)
  })

  it('exposes no tools when the whitelist is empty', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools([])
    assert.deepStrictEqual(registry.list().tools, [])
    assert.strictEqual(registry.has('a'), false)
    assert.strictEqual(registry.isAllowed('a'), false)
  })

  it('rejects calls to blocked tools', async () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    await assert.rejects(registry.call('b', {}, { token: CancellationToken.None }), /Unknown tool/)
    let result = await registry.call('a', {}, { token: CancellationToken.None })
    assert.strictEqual(result.content[0].text, 'a')
  })

  it('restores full access with a null whitelist', () => {
    let registry = sampleRegistry()
    registry.setAllowedTools(['a'])
    registry.setAllowedTools(null)
    assert.deepStrictEqual(registry.list().tools.map(t => t.name), ['a', 'b'])
  })

  it('clears registered tools on dispose', () => {
    let registry = sampleRegistry()
    registry.unregister('missing')
    registry.dispose()
    assert.deepStrictEqual(registry.list().tools, [])
  })
})
