'use strict'
import { describe, expect, it } from 'vitest'
import { createDocumentTools } from '../../mcp/tools/document'
import { createLspTools } from '../../mcp/tools/lsp'
import { createWorkspaceTools } from '../../mcp/tools/workspace'
import { McpServer } from '../../mcp/server'
import { McpTool, ToolRegistry } from '../../mcp/tools'
import { encodeMessage } from '../../mcp/framing'
import { TestClient } from '../mcp/testClient'

async function authInit(client: TestClient): Promise<void> {
  await client.request(0, 'coc/auth', { token: 'sec-token' })
  await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
  client.notify('notifications/initialized')
}

async function pollUntil(fn: () => boolean, ms: number): Promise<void> {
  let deadline = Date.now() + ms
  while (!fn() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('mcp security hardening', () => {
  it('limits requests per session', async () => {
    let server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'sec-token',
      authRequired: true,
      maxClients: 2,
      maxRequestsPerSecond: 1
    }, new ToolRegistry())
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let errors = 0
    let ok = 0
    for (let i = 10; i < 14; i++) {
      try {
        await client.request(i, 'ping')
        ok++
      } catch (e) {
        expect(String(e)).toContain('Rate limit')
        errors++
      }
    }
    expect(ok).toBeGreaterThanOrEqual(1)
    expect(errors).toBeGreaterThanOrEqual(2)
    client.close()
    server.dispose()
  })

  it('serializes mutating tool calls across sessions with a global write lock', async () => {
    let order: string[] = []
    let count = 0
    let started: () => void = () => {}
    let startedPromise = new Promise<void>(resolve => {
      started = resolve
    })
    let release: () => void = () => {}
    let gate = new Promise<void>(resolve => {
      release = resolve
    })
    let slowwrite: McpTool = {
      name: 'slowwrite',
      description: 'Slow mutating tool',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async () => {
        let n = ++count
        started()
        order.push(`start:${n}`)
        await gate
        order.push(`end:${n}`)
        return { content: [{ type: 'text', text: `done ${n}` }] }
      }
    }
    let echo: McpTool = {
      name: 'echo',
      description: 'Read only echo',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      annotations: { readOnlyHint: true },
      handler: (args: any) => ({
        content: [{ type: 'text', text: String(args?.value ?? '') }],
        structuredContent: { value: args?.value }
      })
    }
    let registry = new ToolRegistry()
    registry.register(slowwrite)
    registry.register(echo)
    let server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'sec-token',
      authRequired: true,
      maxClients: 4,
      timeout: 3000
    }, registry)
    let address = await server.listen()
    let a = new TestClient(address.port)
    let b = new TestClient(address.port)
    let c = new TestClient(address.port)
    await authInit(a)
    await authInit(b)
    await authInit(c)
    let aCall = a.request(20, 'tools/call', { name: 'slowwrite', arguments: {} })
    await startedPromise
    // B's mutating call must wait for the write lock
    let bCall = b.request(30, 'tools/call', { name: 'slowwrite', arguments: {} })
    // C's read-only call (different session) must not be blocked by the lock
    let cEcho = c.request(31, 'tools/call', { name: 'echo', arguments: { value: 'parallel' } })
    let echoResult = await Promise.race([
      cEcho,
      new Promise((_, reject) => setTimeout(() => reject(new Error('echo was blocked by the write lock')), 2000))
    ])
    expect(echoResult.content[0].text).toBe('parallel')
    expect(count).toBe(1)
    release()
    let [aResult, bResult] = await Promise.all([aCall, bCall])
    expect(aResult.content[0].text).toBe('done 1')
    expect(bResult.content[0].text).toBe('done 2')
    expect(order).toEqual(['start:1', 'end:1', 'start:2', 'end:2'])
    a.close()
    b.close()
    c.close()
    server.dispose()
  })

  it('marks destructive and read-only tools with annotations', () => {
    let tools = [...createWorkspaceTools(), ...createDocumentTools(), ...createLspTools()]
    let byName = new Map(tools.map(t => [t.name, t]))
    for (let name of ['workspace/delete_file', 'workspace/rename_file', 'workspace/apply_edit', 'document/apply_edits', 'lsp/apply_code_action', 'lsp/rename']) {
      expect(byName.get(name)?.annotations?.destructiveHint).toBe(true)
    }
    for (let name of ['document/read', 'workspace/search', 'lsp/references', 'lsp/hover']) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true)
    }
  })

  it('drops queued tool calls after exit', async () => {
    let secondEntered = 0
    let release: () => void = () => {}
    let gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started: () => void = () => {}
    let startedPromise = new Promise<void>(resolve => {
      started = resolve
    })
    let slowwrite: McpTool = {
      name: 'slowwrite',
      description: 'Slow mutating tool',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async () => {
        started()
        await gate
        return { content: [{ type: 'text', text: 'done' }] }
      }
    }
    let secondwrite: McpTool = {
      name: 'secondwrite',
      description: 'Second mutating tool',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async () => {
        secondEntered++
        return { content: [{ type: 'text', text: 'second' }] }
      }
    }
    let registry = new ToolRegistry()
    registry.register(slowwrite)
    registry.register(secondwrite)
    let server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'sec-token',
      authRequired: true,
      maxClients: 2,
      timeout: 0
    }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    // One TCP write: slow call, exit, then another destructive call. The exit
    // closes the session, so the queued second call must never run.
    client.socket.write(Buffer.concat([
      encodeMessage({ jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'slowwrite', arguments: {} } }),
      encodeMessage({ jsonrpc: '2.0', method: 'notifications/exit' }),
      encodeMessage({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'secondwrite', arguments: {} } })
    ]))
    await startedPromise
    release()
    await client.onClosed()
    // The exit task closes the session in the same event-loop turn as the
    // queued second call would have run; a short settle is enough for the
    // buggy behavior to manifest.
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(secondEntered).toBe(0)
    client.close()
    server.dispose()
  })

  it('server dispose cancels pending tokens and drops queued writes', async () => {
    let secondEntered = 0
    let cancelled = 0
    let release: () => void = () => {}
    let gate = new Promise<void>(resolve => {
      release = resolve
    })
    let started: () => void = () => {}
    let startedPromise = new Promise<void>(resolve => {
      started = resolve
    })
    let slowwrite: McpTool = {
      name: 'slowwrite',
      description: 'Slow mutating tool',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async (_args, ctx) => {
        started()
        ctx.token.onCancellationRequested(() => {
          cancelled++
        })
        await gate
        return { content: [{ type: 'text', text: 'done' }] }
      }
    }
    let secondwrite: McpTool = {
      name: 'secondwrite',
      description: 'Second mutating tool',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async () => {
        secondEntered++
        return { content: [{ type: 'text', text: 'second' }] }
      }
    }
    let registry = new ToolRegistry()
    registry.register(slowwrite)
    registry.register(secondwrite)
    let server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'sec-token',
      authRequired: true,
      maxClients: 2,
      timeout: 0
    }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    client.socket.write(Buffer.concat([
      encodeMessage({ jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'slowwrite', arguments: {} } }),
      encodeMessage({ jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'secondwrite', arguments: {} } })
    ]))
    await startedPromise
    server.dispose()
    release()
    await pollUntil(() => secondEntered > 0 || cancelled > 0, 1000)
    expect(secondEntered).toBe(0)
    expect(cancelled).toBeGreaterThan(0)
    client.close()
  })

  it('client cancel releases in-flight slots even when the tool ignores cancellation', async () => {
    let entered = 0
    let resolveNever: ((v: any) => void) | null = null
    let never: McpTool = {
      name: 'never',
      description: 'Never settles',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      handler: () => {
        entered++
        return new Promise(resolve => {
          resolveNever = resolve
        })
      }
    }
    let echo: McpTool = {
      name: 'echo',
      description: 'Read only echo',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      annotations: { readOnlyHint: true },
      handler: (args: any) => ({
        content: [{ type: 'text', text: String(args?.value ?? '') }]
      })
    }
    let registry = new ToolRegistry()
    registry.register(never)
    registry.register(echo)
    let server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'sec-token',
      authRequired: true,
      maxClients: 2,
      maxRequestsPerSecond: 1000,
      timeout: 0
    }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    // Fill every in-flight slot with a tool that never settles.
    for (let i = 60; i < 76; i++) {
      client.socket.write(encodeMessage({
        jsonrpc: '2.0',
        id: i,
        method: 'tools/call',
        params: { name: 'never', arguments: {} }
      }))
    }
    await pollUntil(() => entered >= 16, 1000)
    // Cancel each request twice; the accounting must stay idempotent.
    for (let i = 60; i < 76; i++) {
      client.notify('notifications/cancelled', { requestId: i })
      client.notify('notifications/cancelled', { requestId: i })
    }
    // Slots must be released immediately: a new call succeeds instead of
    // returning "Too many concurrent requests".
    let res = await client.request(90, 'tools/call', { name: 'echo', arguments: { value: 'ok' } })
    expect(res.content[0].text).toBe('ok')
    // A late result is consumed silently: no second response for id 60.
    resolveNever?.({ content: [{ type: 'text', text: 'late' }] })
    await new Promise(resolve => setImmediate(resolve))
    expect(client.notifications.some(n => n.id === 60)).toBe(false)
    client.close()
    server.dispose()
  })
})
