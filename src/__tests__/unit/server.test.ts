'use strict'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { McpServer } from '../../mcp/server'
import { McpTool, ToolRegistry } from '../../mcp/tools'
import { TestClient } from '../mcp/testClient'

function echoTool(): McpTool {
  return {
    name: 'echo',
    title: 'Echo',
    description: 'Echo arguments back for testing',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    handler: (args: any) => ({
      content: [{ type: 'text', text: String(args?.value ?? '') }],
      structuredContent: { value: args?.value }
    })
  }
}

describe('mcp server lifecycle', () => {
  let server: McpServer
  let address: { host: string, port: number, socketPath: string }
  let registry: ToolRegistry

  beforeAll(async () => {
    registry = new ToolRegistry()
    registry.register(echoTool())
    registry.register({
      name: 'boom',
      description: 'Tool that throws',
      inputSchema: { type: 'object' },
      handler: () => {
        throw new Error('boom error')
      }
    })
    registry.register({
      name: 'fail',
      description: 'Tool that returns an error result',
      inputSchema: { type: 'object' },
      handler: () => ({
        content: [{ type: 'text', text: 'failed' }],
        isError: true
      })
    })
    server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      authRequired: true,
      maxClients: 4,
      timeout: 1000
    }, registry)
    address = await server.listen()
  })

  afterAll(() => {
    server.dispose()
  })

  async function authClient(): Promise<TestClient> {
    let client = new TestClient(address.port)
    let auth = await client.request(0, 'coc/auth', { token: 'test-token', clientInfo: { name: 'test', version: '1' } })
    assert.strictEqual(auth.ok, true)
    return client
  }

  async function initClient(): Promise<TestClient> {
    let client = await authClient()
    let init = await client.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' }
    })
    assert.strictEqual(init.protocolVersion, '2025-06-18')
    client.notify('notifications/initialized')
    return client
  }

  it('rejects unix transport without a socket path', async () => {
    let invalid = new McpServer({
      transport: 'unix',
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      authRequired: true,
      maxClients: 1,
      timeout: 1000
    })
    await assert.rejects(invalid.listen(), error => String(error instanceof Error ? error.message : error).includes('socketPath is required'))
    invalid.dispose()
  })

  it('rejects invalid auth with -32001 and closes the connection', async () => {
    let client = new TestClient(address.port)
    let error: any
    try {
      await client.request(0, 'coc/auth', { token: 'wrong-token' })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32001'))
    await client.onClosed()
    client.close()
  })

  it('rejects requests before auth', async () => {
    let client = new TestClient(address.port)
    let error: any
    try {
      await client.request(1, 'tools/list')
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32001'))
    await client.onClosed()
    client.close()
  })

  it('rejects tools/list before initialize', async () => {
    let client = await authClient()
    let error: any
    try {
      await client.request(1, 'tools/list')
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32600'))
    client.close()
  })

  it('rejects unsupported protocol versions', async () => {
    let client = await authClient()
    let error: any
    try {
      await client.request(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {} })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32600'))
    assert.ok((error.message).includes('2024-11-05'))
    client.close()
  })

  it('accepts protocol version 2024-11-05 and omits newer fields', async () => {
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', { token: 'test-token' })
    let init = await client.request(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' }
    })
    assert.strictEqual(init.protocolVersion, '2024-11-05')
    client.notify('notifications/initialized')
    // 2024-11-05 Tool is limited to name/description/inputSchema; title,
    // annotations and outputSchema were added in later revisions.
    let disposable = registry.register({
      name: 'annotated',
      title: 'Annotated',
      description: 'Tool with newer metadata',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true } })
    })
    let list = await client.request(2, 'tools/list')
    let annotated: any = list.tools.find((t: any) => t.name === 'annotated')
    assert.deepStrictEqual(annotated, {
      name: 'annotated',
      description: 'Tool with newer metadata',
      inputSchema: { type: 'object' }
    })
    assert.strictEqual((annotated as any).title, undefined)
    assert.strictEqual((annotated as any).annotations, undefined)
    assert.strictEqual((annotated as any).outputSchema, undefined)
    // 2024-11-05 CallToolResult has no structuredContent (added 2025-06-18).
    let call = await client.request(3, 'tools/call', { name: 'annotated', arguments: {} })
    assert.strictEqual(call.content[0].text, 'ok')
    assert.strictEqual(call.structuredContent, undefined)
    disposable.dispose()
    client.close()
  })

  it('emits tools/list_changed to 2024-11-05 clients', async () => {
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', { token: 'test-token' })
    await client.request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} })
    client.notify('notifications/initialized')
    let changed = client.waitNotification('notifications/tools/list_changed')
    registry.register({
      name: 'late-2024',
      description: 'Late registered tool',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let msg = await changed
    assert.strictEqual(msg.method, 'notifications/tools/list_changed')
    client.close()
  })

  it('accepts protocol version 2025-11-25 and reports server description', async () => {
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', { token: 'test-token' })
    let init = await client.request(1, 'initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' }
    })
    assert.strictEqual(init.protocolVersion, '2025-11-25')
    assert.ok(init.serverInfo.description)
    client.close()
  })

  it('returns input validation errors as tool errors on 2025-11-25', async () => {
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', { token: 'test-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {} })
    client.notify('notifications/initialized')
    let result = await client.request(2, 'tools/call', { name: 'echo', arguments: 'not-an-object' })
    assert.strictEqual(result.isError, true)
    assert.ok((result.content[0].text).includes('must be an object'))
    client.close()
  })

  it('returns -32602 for invalid arguments on 2025-06-18', async () => {
    let client = await initClient()
    let error: any
    try {
      await client.request(2, 'tools/call', { name: 'echo', arguments: 'not-an-object' })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32602'))
    client.close()
  })

  it('runs the full MCP lifecycle and tool calls', async () => {
    let client = await initClient()
    let list = await client.request(2, 'tools/list')
    let names = list.tools.map((t: any) => t.name)
    assert.ok(['echo', 'boom', 'fail'].every(name => names.includes(name)))
    let call = await client.request(3, 'tools/call', { name: 'echo', arguments: { value: 'hi' } })
    assert.strictEqual(call.structuredContent.value, 'hi')
    assert.strictEqual(call.content[0].text, 'hi')
    let ping = await client.request(4, 'ping')
    assert.deepStrictEqual(ping, {})
    let status = await client.request(5, 'coc/status')
    assert.strictEqual(status.running, true)
    assert.ok((status.tools).includes('echo'))
    let shutdown = await client.request(6, 'shutdown')
    assert.strictEqual(shutdown, null)
    client.notify('notifications/exit')
    await client.onClosed()
    client.close()
  })

  it('rejects unknown tools with -32602', async () => {
    let client = await initClient()
    let error: any
    try {
      await client.request(2, 'tools/call', { name: 'nope', arguments: {} })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32602'))
    client.close()
  })

  it('returns tool execution errors as isError results', async () => {
    let client = await initClient()
    let result = await client.request(2, 'tools/call', { name: 'fail', arguments: {} })
    assert.strictEqual(result.isError, true)
    client.close()
  })

  it('returns internal errors as -32603', async () => {
    let client = await initClient()
    let error: any
    try {
      await client.request(2, 'tools/call', { name: 'boom', arguments: {} })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32603'))
    assert.ok((error.message).includes('boom error'))
    client.close()
  })

  it('emits tools/list_changed when the tool list changes', async () => {
    let client = await initClient()
    let changed = client.waitNotification('notifications/tools/list_changed')
    registry.register({
      name: 'late',
      description: 'Late registered tool',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    let msg = await changed
    assert.strictEqual(msg.method, 'notifications/tools/list_changed')
    client.close()
  })

  it('disposes the shared tool registry subscription on server dispose', async (t) => {
    let registry = new ToolRegistry()
    let first = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      authRequired: true,
      maxClients: 4,
      timeout: 0
    }, registry)
    let firstBroadcast = t.mock.method(first, 'broadcastNotification')
    first.dispose()
    let second = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      authRequired: true,
      maxClients: 4,
      timeout: 0
    }, registry)
    let secondBroadcast = t.mock.method(second, 'broadcastNotification')
    registry.register({
      name: 'shared-tool',
      description: 'Shared tool',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'ok' }] })
    })
    assert.strictEqual((firstBroadcast).mock.callCount(), 0)
    assert.strictEqual((secondBroadcast).mock.callCount(), 1)
    second.dispose()
  })

  it('times out slow tool calls with -32003', async () => {
    let slowRegistry = new ToolRegistry()
    slowRegistry.register({
      name: 'slow',
      description: 'Slow tool',
      inputSchema: { type: 'object' },
      handler: () => new Promise(resolve => {
        setTimeout(() => resolve({ content: [{ type: 'text', text: 'done' }] }), 200)
      })
    })
    let slowServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'slow-token',
      authRequired: true,
      maxClients: 2,
      timeout: 50
    }, slowRegistry)
    let addr = await slowServer.listen()
    let client = new TestClient(addr.port)
    await client.request(0, 'coc/auth', { token: 'slow-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let error: any
    try {
      await client.request(2, 'tools/call', { name: 'slow', arguments: {} })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((error.message).includes('-32003'))
    client.close()
    slowServer.dispose()
  })

  it('processes requests in order so exit does not cut off an in-flight call', async () => {
    let orderRegistry = new ToolRegistry()
    orderRegistry.register({
      name: 'slowok',
      description: 'Slow but responding tool',
      inputSchema: { type: 'object' },
      handler: () => new Promise(resolve => {
        setTimeout(() => resolve({ content: [{ type: 'text', text: 'done' }] }), 100)
      })
    })
    let orderServer = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'order-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, orderRegistry)
    let addr = await orderServer.listen()
    let client = new TestClient(addr.port)
    await client.request(0, 'coc/auth', { token: 'order-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let results: any[] = []
    let callP = client.request(2, 'tools/call', { name: 'slowok', arguments: {} })
      .then(r => results.push(['call', r]))
    let shutP = client.request(3, 'shutdown')
      .then(r => results.push(['shutdown', r]))
    client.notify('notifications/exit')
    await Promise.all([callP, shutP])
    await client.onClosed()
    assert.deepStrictEqual(results.map(r => r[0]), ['call', 'shutdown'])
    assert.strictEqual(results[0][1].content[0].text, 'done')
    client.close()
    orderServer.dispose()
  })

  it('handles roots and logging messages', async () => {
    let client = await initClient()
    client.notify('notifications/roots/list_changed', { roots: [{ uri: 'file:///workspace' }] })
    let roots = await client.request(2, 'roots/list')
    assert.deepStrictEqual(roots.roots, [{ uri: 'file:///workspace' }])
    let level = await client.request(3, 'logging/setLevel', { level: 'debug' })
    assert.strictEqual(level, null)
    client.close()
  })
})

describe('mcp server hardening', () => {
  function newServer(options: any = {}, tools?: ToolRegistry): McpServer {
    return new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      authRequired: true,
      maxClients: 4,
      timeout: 1000,
      ...options
    }, tools ?? new ToolRegistry())
  }

  async function authInit(client: TestClient): Promise<void> {
    await client.request(0, 'coc/auth', { token: 'test-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
  }

  async function waitFor(fn: () => boolean, timeout = 3000): Promise<void> {
    let start = Date.now()
    while (!fn()) {
      if (Date.now() - start > timeout) throw new Error('waitFor timeout')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  it('rejects connections beyond maxClients', async () => {
    let server = newServer({ maxClients: 1 })
    let address = await server.listen()
    let a = new TestClient(address.port)
    await authInit(a)
    let b = new TestClient(address.port)
    let error: any
    try {
      await b.request(0, 'coc/auth', { token: 'test-token' })
    } catch (e) {
      error = e
    }
    assert.ok(error)
    assert.ok((String(error)).includes('Connection closed'))
    a.close()
    b.close()
    server.dispose()
  })

  it('closes idle sessions after idleTimeout', async () => {
    let server = newServer({ idleTimeout: 100 })
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    await Promise.race([
      client.onClosed(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('idle session was not closed')), 2000))
    ])
    client.close()
    server.dispose()
  })

  it('exposes only whitelisted tools and rejects calls to the rest', async () => {
    let registry = new ToolRegistry()
    registry.register(echoTool())
    registry.register({
      name: 'blocked',
      description: 'Not whitelisted',
      inputSchema: { type: 'object' },
      handler: () => ({ content: [{ type: 'text', text: 'no' }] })
    })
    registry.setAllowedTools(['echo'])
    let server = newServer({}, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let list = await client.request(2, 'tools/list')
    assert.deepStrictEqual(list.tools.map((t: any) => t.name), ['echo'])
    let blocked: any
    try {
      await client.request(3, 'tools/call', { name: 'blocked', arguments: {} })
    } catch (e) {
      blocked = e
    }
    assert.ok((String(blocked)).includes('allowedTools'))
    let ok = await client.request(4, 'tools/call', { name: 'echo', arguments: { value: 'hi' } })
    assert.strictEqual(ok.content[0].text, 'hi')
    client.close()
    server.dispose()
  })

  it('answers malformed frames with a -32700 parse error', async () => {
    let server = newServer()
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    client.socket.write(Buffer.from('{bad json}\n'))
    await client.request(2, 'ping')
    let parseError = client.notifications.find(n => n.error && n.error.code === -32700)
    assert.ok(parseError)
    client.close()
    server.dispose()
  })

  it('cancels in-flight tool calls via notifications/cancelled', async () => {
    let registry = new ToolRegistry()
    let entered: () => void = () => {}
    let enteredPromise = new Promise<void>(resolve => {
      entered = resolve
    })
    let cancelledObserved: () => void = () => {}
    let cancelledPromise = new Promise<void>(resolve => {
      cancelledObserved = resolve
    })
    registry.register({
      name: 'cancelme',
      description: 'Cancellable tool',
      inputSchema: { type: 'object' },
      handler: async (_args: any, context: any) => {
        entered()
        // complete only when the server processes the cancellation
        await new Promise<void>(resolve => {
          context.token.onCancellationRequested(() => resolve())
        })
        cancelledObserved()
        return { content: [{ type: 'text', text: 'done' }] }
      }
    })
    let server = newServer({ timeout: 3000 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let call = client.request(2, 'tools/call', { name: 'cancelme', arguments: {} })
    await enteredPromise
    // a real client sends the cancellation after the call started
    client.notify('notifications/cancelled', { requestId: 2 })
    await cancelledPromise
    // a cancelled request must not receive a response
    client.close()
    await assert.rejects(call, error => String(error instanceof Error ? error.message : error).includes('Connection closed'))
    assert.strictEqual(client.notifications.some(n => n.id === 2), false)
    client.close()
    server.dispose()
  })

  it('cancels the in-flight token when a tool times out', async () => {
    let observed = false
    let registry = new ToolRegistry()
    registry.register({
      name: 'slowtimeout',
      description: 'Slow tool that only finishes on cancellation',
      inputSchema: { type: 'object' },
      handler: async (_args: any, context: any) => {
        await new Promise<void>(resolve => {
          context.token.onCancellationRequested(() => resolve())
        })
        observed = context.token.isCancellationRequested === true
        return { content: [{ type: 'text', text: 'late' }] }
      }
    })
    let server = newServer({ timeout: 100 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let error: any
    try {
      await client.request(2, 'tools/call', { name: 'slowtimeout', arguments: {} })
    } catch (e) {
      error = e
    }
    assert.ok((String(error)).includes('-32003'))
    // the timeout must cancel the token, so the handler observed cancellation
    await waitFor(() => observed === true)
    client.close()
    server.dispose()
  })

  it('does not time out a request after it was cancelled', async () => {
    let registry = new ToolRegistry()
    let entered: () => void = () => {}
    let enteredPromise = new Promise<void>(resolve => {
      entered = resolve
    })
    let release: () => void = () => {}
    let gate = new Promise<void>(resolve => {
      release = resolve
    })
    registry.register({
      name: 'cancelthenfinish',
      description: 'Finishes after being cancelled',
      inputSchema: { type: 'object' },
      handler: async (_args: any, context: any) => {
        entered()
        await new Promise<void>(resolve => {
          context.token.onCancellationRequested(() => resolve())
        })
        await gate
        return {
          content: [{ type: 'text', text: 'done' }],
          structuredContent: { cancelled: context.token.isCancellationRequested }
        }
      }
    })
    let server = newServer({ timeout: 100 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let call = client.request(2, 'tools/call', { name: 'cancelthenfinish', arguments: {} })
    await enteredPromise
    client.notify('notifications/cancelled', { requestId: 2 })
    release()
    // wait past the timeout window: cancellation must have cleared the timer,
    // so no spurious -32003 arrives
    await new Promise(resolve => setTimeout(resolve, 150))
    assert.strictEqual(client.notifications.some(n => n.error && n.error.code === -32003), false)
    assert.strictEqual(client.notifications.some(n => n.id === 2), false)
    client.close()
    await assert.rejects(call, error => String(error instanceof Error ? error.message : error).includes('Connection closed'))
    client.close()
    server.dispose()
  })

  it('uses a longer timeout for read-only tools and mcp.timeout for mutating tools', async () => {
    let registry = new ToolRegistry()
    registry.register({
      name: 'slowread',
      description: 'Never resolves',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      handler: () => new Promise(() => {})
    })
    registry.register({
      name: 'slowwrite',
      description: 'Never resolves',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: () => new Promise(() => {})
    })
    let server = newServer({ timeout: 100, readTimeout: 300 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)

    // mutating tool uses mcp.timeout (100ms)
    let start = Date.now()
    let error: any
    try {
      await client.request(2, 'tools/call', { name: 'slowwrite', arguments: {} })
    } catch (e) {
      error = e
    }
    assert.ok((String(error)).includes('-32003'))
    assert.ok((Date.now() - start) < (400))

    // read-only tool uses readTimeout (300ms), not the 100ms default
    start = Date.now()
    let readError: any
    try {
      await client.request(3, 'tools/call', { name: 'slowread', arguments: {} })
    } catch (e) {
      readError = e
    }
    assert.ok((String(readError)).includes('-32003'))
    assert.ok((Date.now() - start) >= (200))
    client.close()
    server.dispose()
  })

  it('runs read-only tool calls in parallel within a session', async () => {
    let registry = new ToolRegistry()
    let starts: string[] = []
    let release1: () => void = () => {}
    let release2: () => void = () => {}
    let gate1 = new Promise<void>(resolve => {
      release1 = resolve
    })
    let gate2 = new Promise<void>(resolve => {
      release2 = resolve
    })
    registry.register({
      name: 'pread1',
      description: 'read only 1',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      handler: async () => {
        starts.push('1')
        await gate1
        return { content: [{ type: 'text', text: 'one' }] }
      }
    })
    registry.register({
      name: 'pread2',
      description: 'read only 2',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
      handler: async () => {
        starts.push('2')
        await gate2
        return { content: [{ type: 'text', text: 'two' }] }
      }
    })
    let server = newServer({ timeout: 2000 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let a = client.request(2, 'tools/call', { name: 'pread1', arguments: {} })
    let b = client.request(3, 'tools/call', { name: 'pread2', arguments: {} })
    // both handlers must have entered while both gates are still held
    await waitFor(() => starts.length === 2)
    release1()
    release2()
    let [ra, rb] = await Promise.all([a, b])
    assert.strictEqual(ra.content[0].text, 'one')
    assert.strictEqual(rb.content[0].text, 'two')
    client.close()
    server.dispose()
  })

  it('keeps mutating tool calls serialized within a session', async () => {
    let registry = new ToolRegistry()
    let order: string[] = []
    let release: () => void = () => {}
    let gate = new Promise<void>(resolve => {
      release = resolve
    })
    registry.register({
      name: 'pwrite1',
      description: 'mutating 1',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async () => {
        order.push('1-start')
        await gate
        order.push('1-end')
        return { content: [{ type: 'text', text: 'one' }] }
      }
    })
    registry.register({
      name: 'pwrite2',
      description: 'mutating 2',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
      handler: async () => {
        order.push('2-start')
        order.push('2-end')
        return { content: [{ type: 'text', text: 'two' }] }
      }
    })
    let server = newServer({ timeout: 2000 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let a = client.request(2, 'tools/call', { name: 'pwrite1', arguments: {} })
    await waitFor(() => order.includes('1-start'))
    let b = client.request(3, 'tools/call', { name: 'pwrite2', arguments: {} })
    release()
    let [ra, rb] = await Promise.all([a, b])
    assert.strictEqual(ra.content[0].text, 'one')
    assert.strictEqual(rb.content[0].text, 'two')
    assert.deepStrictEqual(order, ['1-start', '1-end', '2-start', '2-end'])
    client.close()
    server.dispose()
  })

  it('rate limits per session without blocking other sessions', async () => {
    let server = newServer({ maxRequestsPerSecond: 1 })
    let address = await server.listen()
    let a = new TestClient(address.port)
    let b = new TestClient(address.port)
    await authInit(a)
    await authInit(b)
    let aErr = 0
    for (let i = 10; i < 13; i++) {
      try {
        await a.request(i, 'ping')
      } catch (e) {
        assert.ok((String(e)).includes('Rate limit'))
        aErr++
      }
    }
    let bOk = 0
    for (let i = 20; i < 23; i++) {
      try {
        await b.request(i, 'ping')
        bOk++
      } catch (_e) {
        // b has its own limit
      }
    }
    assert.ok((aErr) >= (1))
    assert.ok((bOk) >= (1))
    a.close()
    b.close()
    server.dispose()
  })

  it('serves unix sockets on macOS/Linux', async () => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-mcp-unix-'))
    let socketPath = path.join(dir, 'mcp.sock')
    let server = new McpServer({
      transport: 'unix',
      host: '',
      port: 0,
      socketPath,
      token: 'unix-token',
      authRequired: true,
      maxClients: 2,
      timeout: 1000
    }, new ToolRegistry())
    let address = await server.listen()
    assert.strictEqual(address.socketPath, socketPath)
    let client = new TestClient(socketPath)
    await client.request(0, 'coc/auth', { token: 'unix-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let ping = await client.request(2, 'ping')
    assert.deepStrictEqual(ping, {})
    client.close()
    server.dispose()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reports client pid, connect time and last activity in status', async () => {
    let server = newServer()
    let address = await server.listen()
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', {
      token: 'test-token',
      clientInfo: { name: 'test-client', version: '1', pid: 424242 }
    })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let status = server.status()
    assert.strictEqual(status.clients.length, 1)
    let entry = status.clients[0]
    assert.strictEqual(entry.pid, 424242)
    assert.strictEqual(entry.name, 'test-client')
    assert.strictEqual(typeof entry.connectedAt, 'number')
    let lastBefore = entry.lastActiveAt
    assert.ok((lastBefore) >= (entry.connectedAt))
    await client.request(2, 'ping')
    let after = server.status().clients[0]
    assert.ok((after.lastActiveAt) >= (lastBefore))
    client.close()
    server.dispose()
  })

  it('removes a client from status after its socket closes', async () => {
    let server = newServer()
    let address = await server.listen()
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', {
      token: 'test-token',
      clientInfo: { name: 'test', version: '1', pid: 777 }
    })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    assert.strictEqual(server.status().clients.length, 1)
    client.close()
    await waitFor(() => server.status().clients.length === 0)
    server.dispose()
  })

  it('requires a valid signature when a client public key is configured', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let server = newServer({ authClientPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() })
    let address = await server.listen()

    // token alone is rejected
    let client = new TestClient(address.port)
    let error: any
    try {
      await client.request(0, 'coc/auth', { token: 'test-token' })
    } catch (e) {
      error = e
    }
    assert.ok((String(error)).includes('-32001'))
    await client.onClosed()
    client.close()

    // challenge + signature succeeds
    let okClient = new TestClient(address.port)
    let challenge = await okClient.request(0, 'coc/challenge')
    let nonce = challenge.nonce
    let signature = crypto.sign('sha256', Buffer.from(nonce), privateKey).toString('base64')
    let auth = await okClient.request(1, 'coc/auth', { token: 'test-token', nonce, signature })
    assert.strictEqual(auth.ok, true)
    await okClient.request(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    okClient.notify('notifications/initialized')
    let ping = await okClient.request(3, 'ping')
    assert.deepStrictEqual(ping, {})
    okClient.close()
    server.dispose()
  })

  it('rejects a bad signature and a mismatched nonce', async () => {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let server = newServer({ authClientPublicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() })
    let address = await server.listen()

    // signed with the wrong private key
    let bad = new TestClient(address.port)
    let challenge = await bad.request(0, 'coc/challenge')
    let signature = crypto.sign('sha256', Buffer.from(challenge.nonce), other.privateKey).toString('base64')
    let error: any
    try {
      await bad.request(1, 'coc/auth', { token: 'test-token', nonce: challenge.nonce, signature })
    } catch (e) {
      error = e
    }
    assert.ok((String(error)).includes('-32001'))
    await bad.onClosed()
    bad.close()

    // nonce does not match the issued one
    let mismatch = new TestClient(address.port)
    await mismatch.request(0, 'coc/challenge')
    let sig = crypto.sign('sha256', Buffer.from('stale-nonce'), pair.privateKey).toString('base64')
    let mismatchError: any
    try {
      await mismatch.request(1, 'coc/auth', { token: 'test-token', nonce: 'stale-nonce', signature: sig })
    } catch (e) {
      mismatchError = e
    }
    assert.ok((String(mismatchError)).includes('-32001'))
    await mismatch.onClosed()
    mismatch.close()
    server.dispose()
  })

  it('accepts signature-only auth when a client public key is configured', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    let server = newServer({ authClientPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() })
    let address = await server.listen()

    // no token at all: possession of the private key is the authentication,
    // so the bridge can connect over a forwarded SSH port without copying
    // the token-bearing discovery file
    let client = new TestClient(address.port)
    let challenge = await client.request(0, 'coc/challenge')
    let signature = crypto.sign('sha256', Buffer.from(challenge.nonce), privateKey).toString('base64')
    let auth = await client.request(1, 'coc/auth', { nonce: challenge.nonce, signature })
    assert.strictEqual(auth.ok, true)
    await client.request(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let ping = await client.request(3, 'ping')
    assert.deepStrictEqual(ping, {})
    client.close()
    server.dispose()
  })
})
