'use strict'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpServer } from '../../mcp/server'
import { McpTool, ToolRegistry } from '../../mcp/tools'
import { TestClient } from './testClient'

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
    expect(auth.ok).toBe(true)
    return client
  }

  async function initClient(): Promise<TestClient> {
    let client = await authClient()
    let init = await client.request(1, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' }
    })
    expect(init.protocolVersion).toBe('2025-06-18')
    client.notify('notifications/initialized')
    return client
  }

  it('rejects invalid auth with -32001 and closes the connection', async () => {
    let client = new TestClient(address.port)
    let error: any
    try {
      await client.request(0, 'coc/auth', { token: 'wrong-token' })
    } catch (e) {
      error = e
    }
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32001')
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
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32001')
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
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32600')
    client.close()
  })

  it('rejects unsupported protocol versions', async () => {
    let client = await authClient()
    let error: any
    try {
      await client.request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {} })
    } catch (e) {
      error = e
    }
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32600')
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
    expect(init.protocolVersion).toBe('2025-11-25')
    expect(init.serverInfo.description).toBeTruthy()
    client.close()
  })

  it('returns input validation errors as tool errors on 2025-11-25', async () => {
    let client = new TestClient(address.port)
    await client.request(0, 'coc/auth', { token: 'test-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {} })
    client.notify('notifications/initialized')
    let result = await client.request(2, 'tools/call', { name: 'echo', arguments: 'not-an-object' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('must be an object')
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
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32602')
    client.close()
  })

  it('runs the full MCP lifecycle and tool calls', async () => {
    let client = await initClient()
    let list = await client.request(2, 'tools/list')
    expect(list.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['echo', 'boom', 'fail']))
    let call = await client.request(3, 'tools/call', { name: 'echo', arguments: { value: 'hi' } })
    expect(call.structuredContent.value).toBe('hi')
    expect(call.content[0].text).toBe('hi')
    let ping = await client.request(4, 'ping')
    expect(ping).toEqual({})
    let status = await client.request(5, 'coc/status')
    expect(status.running).toBe(true)
    expect(status.tools).toContain('echo')
    let shutdown = await client.request(6, 'shutdown')
    expect(shutdown).toBeNull()
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
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32602')
    client.close()
  })

  it('returns tool execution errors as isError results', async () => {
    let client = await initClient()
    let result = await client.request(2, 'tools/call', { name: 'fail', arguments: {} })
    expect(result.isError).toBe(true)
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
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32603')
    expect(error.message).toContain('boom error')
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
    expect(msg.method).toBe('notifications/tools/list_changed')
    client.close()
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
    expect(error).toBeTruthy()
    expect(error.message).toContain('-32003')
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
    expect(results.map(r => r[0])).toEqual(['call', 'shutdown'])
    expect(results[0][1].content[0].text).toBe('done')
    client.close()
    orderServer.dispose()
  })

  it('handles roots and logging messages', async () => {
    let client = await initClient()
    client.notify('notifications/roots/list_changed', { roots: [{ uri: 'file:///workspace' }] })
    let roots = await client.request(2, 'roots/list')
    expect(roots.roots).toEqual([{ uri: 'file:///workspace' }])
    let level = await client.request(3, 'logging/setLevel', { level: 'debug' })
    expect(level).toBeNull()
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
    expect(error).toBeTruthy()
    expect(String(error)).toContain('Connection closed')
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
    expect(list.tools.map((t: any) => t.name)).toEqual(['echo'])
    let blocked: any
    try {
      await client.request(3, 'tools/call', { name: 'blocked', arguments: {} })
    } catch (e) {
      blocked = e
    }
    expect(String(blocked)).toContain('allowedTools')
    let ok = await client.request(4, 'tools/call', { name: 'echo', arguments: { value: 'hi' } })
    expect(ok.content[0].text).toBe('hi')
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
    expect(parseError).toBeTruthy()
    client.close()
    server.dispose()
  })

  it('cancels in-flight tool calls via notifications/cancelled', async () => {
    let registry = new ToolRegistry()
    let entered: () => void = () => {}
    let enteredPromise = new Promise<void>(resolve => {
      entered = resolve
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
        let cancelled = context.token.isCancellationRequested === true
        return { content: [{ type: 'text', text: 'done' }], structuredContent: { cancelled } }
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
    let result = await call
    expect(result.structuredContent.cancelled).toBe(true)
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
    expect(String(error)).toContain('-32003')
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
    let server = newServer({ timeout: 300 }, registry)
    let address = await server.listen()
    let client = new TestClient(address.port)
    await authInit(client)
    let call = client.request(2, 'tools/call', { name: 'cancelthenfinish', arguments: {} })
    await enteredPromise
    client.notify('notifications/cancelled', { requestId: 2 })
    release()
    let result = await call
    expect(result.structuredContent.cancelled).toBe(true)
    // wait past the timeout window: cancellation must have cleared the timer,
    // so no spurious -32003 arrives
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(client.notifications.some(n => n.error && n.error.code === -32003)).toBe(false)
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
    expect(String(error)).toContain('-32003')
    expect(Date.now() - start).toBeLessThan(400)

    // read-only tool uses readTimeout (300ms), not the 100ms default
    start = Date.now()
    let readError: any
    try {
      await client.request(3, 'tools/call', { name: 'slowread', arguments: {} })
    } catch (e) {
      readError = e
    }
    expect(String(readError)).toContain('-32003')
    expect(Date.now() - start).toBeGreaterThanOrEqual(200)
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
    expect(ra.content[0].text).toBe('one')
    expect(rb.content[0].text).toBe('two')
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
    expect(ra.content[0].text).toBe('one')
    expect(rb.content[0].text).toBe('two')
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end'])
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
        expect(String(e)).toContain('Rate limit')
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
    expect(aErr).toBeGreaterThanOrEqual(1)
    expect(bOk).toBeGreaterThanOrEqual(1)
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
    expect(address.socketPath).toBe(socketPath)
    let client = new TestClient(socketPath)
    await client.request(0, 'coc/auth', { token: 'unix-token' })
    await client.request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let ping = await client.request(2, 'ping')
    expect(ping).toEqual({})
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
    expect(status.clients.length).toBe(1)
    let entry = status.clients[0]
    expect(entry.pid).toBe(424242)
    expect(entry.name).toBe('test-client')
    expect(typeof entry.connectedAt).toBe('number')
    let lastBefore = entry.lastActiveAt
    expect(lastBefore).toBeGreaterThanOrEqual(entry.connectedAt)
    await client.request(2, 'ping')
    let after = server.status().clients[0]
    expect(after.lastActiveAt).toBeGreaterThanOrEqual(lastBefore)
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
    expect(server.status().clients.length).toBe(1)
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
    expect(String(error)).toContain('-32001')
    await client.onClosed()
    client.close()

    // challenge + signature succeeds
    let okClient = new TestClient(address.port)
    let challenge = await okClient.request(0, 'coc/challenge')
    let nonce = challenge.nonce
    let signature = crypto.sign('sha256', Buffer.from(nonce), privateKey).toString('base64')
    let auth = await okClient.request(1, 'coc/auth', { token: 'test-token', nonce, signature })
    expect(auth.ok).toBe(true)
    await okClient.request(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    okClient.notify('notifications/initialized')
    let ping = await okClient.request(3, 'ping')
    expect(ping).toEqual({})
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
    expect(String(error)).toContain('-32001')
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
    expect(String(mismatchError)).toContain('-32001')
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
    expect(auth.ok).toBe(true)
    await client.request(2, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    client.notify('notifications/initialized')
    let ping = await client.request(3, 'ping')
    expect(ping).toEqual({})
    client.close()
    server.dispose()
  })
})
