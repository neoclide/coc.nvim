'use strict'
import type { Socket } from 'net'
import { handleInitialize, handleMessage, normalizeResult } from '../../mcp/dispatcher'
import * as P from '../../mcp/protocol'
import { McpServer } from '../../mcp/server'
import { Session } from '../../mcp/session'
import { ToolRegistry } from '../../mcp/tools'
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('mcp dispatcher', () => {
  let socket: Socket
  let server: McpServer
  let session: Session

  beforeEach((t: any) => {
    socket = {
      write: t.mock.fn(),
      end: t.mock.fn()
    } as unknown as Socket
    let tools = new ToolRegistry()
    tools.register({
      name: 'primitive',
      description: 'Return a primitive result',
      inputSchema: { type: 'object' },
      handler: () => 'plain text' as any
    })
    server = new McpServer({
      transport: 'tcp',
      host: '127.0.0.1',
      port: 0,
      token: 'token',
      authRequired: true,
      maxClients: 1,
      timeout: 1000
    }, tools)
    session = new Session(socket, t.mock.fn(), 0)
  })

  afterEach(() => {
    session.close()
    server.dispose()
  })

  function messages(): any[] {
    // node:test records call objects ({ arguments, ... }), not arg arrays.
    return (socket.write as any).mock.calls.map(call => JSON.parse(call.arguments[0].toString('utf8')))
  }

  function initializeSession(): void {
    session.authenticated = true
    session.initialized = true
    session.protocolVersion = '2025-06-18'
  }

  it('rejects malformed JSON-RPC messages', async () => {
    await handleMessage(server, session, { id: 1, method: 'ping' })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_INVALID_REQUEST)
    await handleMessage(server, session, null)
    assert.strictEqual(messages()[1].id, null)
  })

  it('requires a tool name', async () => {
    initializeSession()
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_INVALID_PARAMS)
    assert.ok(messages()[0].error.message.includes('Tool name'))
  })

  it('normalizes primitive tool results', async () => {
    initializeSession()
    await handleMessage(server, session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'primitive', arguments: {} }
    })
    assert.deepStrictEqual(messages()[0].result, {
      content: [{ type: 'text', text: 'plain text' }],
      isError: false,
      structuredContent: 'plain text'
    })
  })

  it('rejects repeated authentication', async () => {
    session.authenticated = true
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'coc/auth', params: { token: 'token' } })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_INVALID_REQUEST)
    assert.ok(messages()[0].error.message.includes('Already authenticated'))
    await handleMessage(server, session, { jsonrpc: '2.0', method: 'coc/auth', params: { token: 'token' } })
    assert.strictEqual(messages().length, 1)
  })

  it('allows ping before initialization', async () => {
    session.authenticated = true
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'ping' })
    assert.deepStrictEqual(messages()[0].result, {})
  })

  it('rejects requests after shutdown', async () => {
    initializeSession()
    session.shutdown = true
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'ping' })
    assert.ok(messages()[0].error.message.includes('shutting down'))
  })

  it('requires a resource URI', async () => {
    initializeSession()
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_INVALID_PARAMS)
    assert.ok(messages()[0].error.message.includes('uri is required'))
  })

  it('returns an internal error when a resource provider throws unexpectedly', async t => {
    initializeSession()
    t.mock.method(server.resources, 'read', async () => {
      throw new Error('resource failed')
    })
    await handleMessage(server, session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'coc://broken' }
    })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_INTERNAL_ERROR)
    assert.ok(messages()[0].error.message.includes('resource failed'))
  })

  it('rejects unknown methods', async () => {
    initializeSession()
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'unknown/method' })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_METHOD_NOT_FOUND)
  })

  it('normalizes compliant and legacy tool results', () => {
    let result = { content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true } }
    assert.strictEqual(normalizeResult(result, '2025-06-18'), result)
    assert.deepStrictEqual(normalizeResult(result, '2024-11-05'), { content: result.content })
    let normalized = normalizeResult(null, '2025-06-18')
    assert.strictEqual(normalized.structuredContent, null)
    assert.strictEqual(normalized.isError, false)
    assert.deepStrictEqual(normalizeResult({ content: [{ type: 'image' }] }, '2024-11-05').content, [
      { type: 'text', text: JSON.stringify({ content: [{ type: 'image' }] }) }
    ])
  })

  it('validates initialize and preserves authenticated client identity', () => {
    session.clientInfo = { name: 'bridge' }
    handleInitialize(server, session, 1, { protocolVersion: 'invalid' })
    assert.strictEqual(messages()[0].error.code, P.JSONRPC_INVALID_REQUEST)
    handleInitialize(server, session, 2, { protocolVersion: '2024-11-05', clientInfo: { name: 'agent' } })
    assert.strictEqual(session.initialized, true)
    assert.deepStrictEqual(session.clientInfo, { name: 'bridge' })
    assert.strictEqual(messages()[1].result.protocolVersion, '2024-11-05')
  })

  it('handles challenge and token authentication requests and notifications', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: P.METHOD_COC_CHALLENGE })
    assert.match(messages()[0].result.nonce, /^[0-9a-f]{64}$/)
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_COC_CHALLENGE })
    assert.strictEqual(messages().length, 1)
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 2, method: P.METHOD_COC_AUTH,
      params: { token: 'token', clientInfo: { name: 'client' } }
    })
    assert.strictEqual(session.authenticated, true)
    assert.deepStrictEqual(session.clientInfo, { name: 'client' })
    assert.strictEqual(messages()[1].result.ok, true)
  })

  it('closes on invalid authentication and unauthenticated messages', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_COC_AUTH, params: { token: 'bad' } })
    assert.strictEqual(session.active, false)
    assert.strictEqual(messages().length, 0)
  })

  it('rejects unauthenticated requests and ignores later inactive messages', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: P.METHOD_PING })
    assert.strictEqual(messages()[0].error.code, P.COC_AUTH_FAILED)
    await handleMessage(server, session, { jsonrpc: '2.0', id: 2, method: P.METHOD_PING })
    assert.strictEqual(messages().length, 1)
  })

  it('closes on unauthenticated notifications without responding', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_PING })
    assert.strictEqual(session.active, false)
    assert.strictEqual(messages().length, 0)
  })

  it('handles pre-initialize notifications and initialize requests', async () => {
    session.authenticated = true
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_PING })
    await handleMessage(server, session, { jsonrpc: '2.0', method: 'unknown' })
    assert.strictEqual(messages().length, 0)
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_INITIALIZE,
      params: { protocolVersion: '2025-11-25', clientInfo: { name: 'agent' } }
    })
    assert.strictEqual(messages()[0].result.protocolVersion, '2025-11-25')
  })

  it('handles lifecycle, roots, logging, subscriptions and catalog methods', async () => {
    initializeSession()
    const call = (method: string, params?: any, id: number | undefined = 1) => handleMessage(server, session, {
      jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params
    })
    await call(P.NOTIFICATION_INITIALIZED, undefined, undefined)
    await call(P.NOTIFICATION_PROGRESS, {}, undefined)
    await call(P.NOTIFICATION_ROOTS_LIST_CHANGED, { roots: [{ uri: 'file:///a' }, {}, { uri: 1 }] }, undefined)
    assert.deepStrictEqual(session.roots, ['file:///a'])
    await call(P.METHOD_ROOTS_LIST)
    assert.deepStrictEqual(messages().at(-1).result.roots, [{ uri: 'file:///a' }])
    await call(P.METHOD_LOGGING_SET_LEVEL, {})
    assert.strictEqual(session.logLevel, 'info')
    await call(P.METHOD_COC_SUBSCRIBE, { events: ['coc/a', 'other', 1] })
    assert.deepStrictEqual(messages().at(-1).result.subscribed, ['coc/a'])
    await call(P.METHOD_COC_UNSUBSCRIBE, { events: ['coc/a', 1] })
    assert.strictEqual(session.subscriptions.size, 0)
    await call(P.METHOD_RESOURCES_LIST)
    assert.ok(messages().at(-1).result.resources.length > 0)
    await call(P.METHOD_RESOURCES_TEMPLATES_LIST)
    assert.strictEqual(messages().at(-1).result.resourceTemplates.length, 1)
    await call(P.METHOD_COC_STATUS)
    assert.ok(messages().at(-1).result)
    await call(P.METHOD_PING)
    assert.deepStrictEqual(messages().at(-1).result, {})
    await call(P.METHOD_LOGGING_SET_LEVEL, { level: 'warning' }, undefined)
    assert.strictEqual(session.logLevel, 'warning')
    await call(P.NOTIFICATION_ROOTS_LIST_CHANGED, {}, undefined)
    assert.deepStrictEqual(session.roots, [])
    await call(P.METHOD_COC_SUBSCRIBE, {})
    assert.deepStrictEqual(messages().at(-1).result.subscribed, [])
    await call(P.METHOD_COC_UNSUBSCRIBE, {})
    assert.deepStrictEqual(messages().at(-1).result.unsubscribed, [])
  })

  it('handles notifications without sending responses', async () => {
    initializeSession()
    for (let method of [P.METHOD_TOOLS_LIST, P.METHOD_TOOLS_CALL, P.METHOD_ROOTS_LIST,
      P.METHOD_COC_STATUS, P.METHOD_COC_SUBSCRIBE, P.METHOD_COC_UNSUBSCRIBE,
      P.METHOD_RESOURCES_LIST, P.METHOD_RESOURCES_TEMPLATES_LIST, P.METHOD_RESOURCES_READ]) {
      await handleMessage(server, session, { jsonrpc: '2.0', method, params: {} })
    }
    assert.strictEqual(messages().length, 0)
  })

  it('filters legacy tool metadata and handles shutdown notifications', async () => {
    initializeSession()
    session.protocolVersion = '2024-11-05'
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: P.METHOD_TOOLS_LIST })
    assert.strictEqual(messages()[0].result.tools[0].name, 'primitive')
    assert.strictEqual(messages()[0].result.tools[0].annotations, undefined)
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_SHUTDOWN })
    assert.strictEqual(session.shutdown, true)
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.NOTIFICATION_EXIT })
    assert.strictEqual(session.active, false)
  })

  it('returns resource-not-found and applies rate limiting', async () => {
    initializeSession()
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_RESOURCES_READ, params: { uri: 'coc://missing' }
    })
    assert.strictEqual(messages()[0].error.code, P.COC_RESOURCE_NOT_FOUND)
    server.options.maxRequestsPerSecond = 1
    await handleMessage(server, session, { jsonrpc: '2.0', id: 2, method: P.METHOD_PING })
    assert.ok(messages()[1].error.message.includes('Rate limit'))
  })

  it('validates unknown and malformed tool calls for both protocol revisions', async () => {
    initializeSession()
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_TOOLS_CALL, params: { name: 'unknown' }
    })
    assert.ok(messages()[0].error.message.includes('Unknown tool'))
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 2, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive', arguments: [] }
    })
    assert.strictEqual(messages()[1].error.code, P.JSONRPC_INVALID_PARAMS)
    session.protocolVersion = '2025-11-25'
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 3, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive', arguments: null }
    })
    assert.strictEqual(messages()[2].result.isError, true)
  })

  it('rejects disallowed tools and saturated sessions', async () => {
    initializeSession()
    server.tools.setAllowedTools([])
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive' }
    })
    assert.ok(messages()[0].error.message.includes('not allowed'))
    server.tools.setAllowedTools(null)
    session.inFlight = server.maxInFlight
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 2, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive' }
    })
    assert.ok(messages()[1].error.message.includes('concurrent'))
  })

  it('ignores shutdown and unknown notifications', async () => {
    initializeSession()
    session.shutdown = true
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_PING })
    await handleMessage(server, session, { jsonrpc: '2.0', method: 'unknown' })
    assert.strictEqual(messages().length, 0)
  })
})
