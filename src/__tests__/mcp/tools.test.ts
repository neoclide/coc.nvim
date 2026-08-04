'use strict'
import { describe, expect, it } from 'vitest'
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
