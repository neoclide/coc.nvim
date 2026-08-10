'use strict'
import type { Socket } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleInitialize, handleMessage, normalizeResult } from '../../mcp/dispatcher'
import * as P from '../../mcp/protocol'
import { McpServer } from '../../mcp/server'
import { Session } from '../../mcp/session'
import { ToolRegistry } from '../../mcp/tools'

describe('mcp dispatcher', () => {
  let socket: Socket
  let server: McpServer
  let session: Session

  beforeEach(() => {
    socket = {
      write: vi.fn(),
      end: vi.fn()
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
    session = new Session(socket, vi.fn(), 0)
  })

  afterEach(() => {
    session.close()
    server.dispose()
  })

  function messages(): any[] {
    return (socket.write as ReturnType<typeof vi.fn>).mock.calls.map(args => JSON.parse((args[0] as Buffer).toString('utf8')))
  }

  function initializeSession(): void {
    session.authenticated = true
    session.initialized = true
    session.protocolVersion = '2025-06-18'
  }

  it('rejects malformed JSON-RPC messages', async () => {
    await handleMessage(server, session, { id: 1, method: 'ping' })
    expect(messages()[0].error.code).toBe(P.JSONRPC_INVALID_REQUEST)
    await handleMessage(server, session, null)
    expect(messages()[1].id).toBeNull()
  })

  it('requires a tool name', async () => {
    initializeSession()
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} })
    expect(messages()[0].error.code).toBe(P.JSONRPC_INVALID_PARAMS)
    expect(messages()[0].error.message).toContain('Tool name')
  })

  it('normalizes primitive tool results', async () => {
    initializeSession()
    await handleMessage(server, session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'primitive', arguments: {} }
    })
    expect(messages()[0].result).toEqual({
      content: [{ type: 'text', text: 'plain text' }],
      isError: false,
      structuredContent: 'plain text'
    })
  })

  it('rejects repeated authentication', async () => {
    session.authenticated = true
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'coc/auth', params: { token: 'token' } })
    expect(messages()[0].error.code).toBe(P.JSONRPC_INVALID_REQUEST)
    expect(messages()[0].error.message).toContain('Already authenticated')
    await handleMessage(server, session, { jsonrpc: '2.0', method: 'coc/auth', params: { token: 'token' } })
    expect(messages()).toHaveLength(1)
  })

  it('allows ping before initialization', async () => {
    session.authenticated = true
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(messages()[0].result).toEqual({})
  })

  it('rejects requests after shutdown', async () => {
    initializeSession()
    session.shutdown = true
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(messages()[0].error.message).toContain('shutting down')
  })

  it('requires a resource URI', async () => {
    initializeSession()
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'resources/read', params: {} })
    expect(messages()[0].error.code).toBe(P.JSONRPC_INVALID_PARAMS)
    expect(messages()[0].error.message).toContain('uri is required')
  })

  it('returns an internal error when a resource provider throws unexpectedly', async () => {
    initializeSession()
    vi.spyOn(server.resources, 'read').mockRejectedValue(new Error('resource failed'))
    await handleMessage(server, session, {
      jsonrpc: '2.0',
      id: 1,
      method: 'resources/read',
      params: { uri: 'coc://broken' }
    })
    expect(messages()[0].error.code).toBe(P.JSONRPC_INTERNAL_ERROR)
    expect(messages()[0].error.message).toContain('resource failed')
  })

  it('rejects unknown methods', async () => {
    initializeSession()
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: 'unknown/method' })
    expect(messages()[0].error.code).toBe(P.JSONRPC_METHOD_NOT_FOUND)
  })

  it('normalizes compliant and legacy tool results', () => {
    let result = { content: [{ type: 'text', text: 'ok' }], structuredContent: { ok: true } }
    expect(normalizeResult(result, '2025-06-18')).toBe(result)
    expect(normalizeResult(result, '2024-11-05')).toEqual({ content: result.content })
    expect(normalizeResult(null, '2025-06-18')).toMatchObject({ structuredContent: null, isError: false })
    expect(normalizeResult({ content: [{ type: 'image' }] }, '2024-11-05')).toMatchObject({
      content: [{ type: 'text', text: JSON.stringify({ content: [{ type: 'image' }] }) }]
    })
  })

  it('validates initialize and preserves authenticated client identity', () => {
    session.clientInfo = { name: 'bridge' }
    handleInitialize(server, session, 1, { protocolVersion: 'invalid' })
    expect(messages()[0].error.code).toBe(P.JSONRPC_INVALID_REQUEST)
    handleInitialize(server, session, 2, { protocolVersion: '2024-11-05', clientInfo: { name: 'agent' } })
    expect(session.initialized).toBe(true)
    expect(session.clientInfo).toEqual({ name: 'bridge' })
    expect(messages()[1].result.protocolVersion).toBe('2024-11-05')
  })

  it('handles challenge and token authentication requests and notifications', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: P.METHOD_COC_CHALLENGE })
    expect(messages()[0].result.nonce).toMatch(/^[0-9a-f]{64}$/)
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_COC_CHALLENGE })
    expect(messages()).toHaveLength(1)
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 2, method: P.METHOD_COC_AUTH,
      params: { token: 'token', clientInfo: { name: 'client' } }
    })
    expect(session.authenticated).toBe(true)
    expect(session.clientInfo).toEqual({ name: 'client' })
    expect(messages()[1].result.ok).toBe(true)
  })

  it('closes on invalid authentication and unauthenticated messages', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_COC_AUTH, params: { token: 'bad' } })
    expect(session.active).toBe(false)
    expect(messages()).toHaveLength(0)
  })

  it('rejects unauthenticated requests and ignores later inactive messages', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: P.METHOD_PING })
    expect(messages()[0].error.code).toBe(P.COC_AUTH_FAILED)
    await handleMessage(server, session, { jsonrpc: '2.0', id: 2, method: P.METHOD_PING })
    expect(messages()).toHaveLength(1)
  })

  it('closes on unauthenticated notifications without responding', async () => {
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_PING })
    expect(session.active).toBe(false)
    expect(messages()).toHaveLength(0)
  })

  it('handles pre-initialize notifications and initialize requests', async () => {
    session.authenticated = true
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_PING })
    await handleMessage(server, session, { jsonrpc: '2.0', method: 'unknown' })
    expect(messages()).toHaveLength(0)
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_INITIALIZE,
      params: { protocolVersion: '2025-11-25', clientInfo: { name: 'agent' } }
    })
    expect(messages()[0].result.protocolVersion).toBe('2025-11-25')
  })

  it('handles lifecycle, roots, logging, subscriptions and catalog methods', async () => {
    initializeSession()
    const call = (method: string, params?: any, id: number | undefined = 1) => handleMessage(server, session, {
      jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params
    })
    await call(P.NOTIFICATION_INITIALIZED, undefined, undefined)
    await call(P.NOTIFICATION_PROGRESS, {}, undefined)
    await call(P.NOTIFICATION_ROOTS_LIST_CHANGED, { roots: [{ uri: 'file:///a' }, {}, { uri: 1 }] }, undefined)
    expect(session.roots).toEqual(['file:///a'])
    await call(P.METHOD_ROOTS_LIST)
    expect(messages().at(-1).result.roots).toEqual([{ uri: 'file:///a' }])
    await call(P.METHOD_LOGGING_SET_LEVEL, {})
    expect(session.logLevel).toBe('info')
    await call(P.METHOD_COC_SUBSCRIBE, { events: ['coc/a', 'other', 1] })
    expect(messages().at(-1).result.subscribed).toEqual(['coc/a'])
    await call(P.METHOD_COC_UNSUBSCRIBE, { events: ['coc/a', 1] })
    expect(session.subscriptions.size).toBe(0)
    await call(P.METHOD_RESOURCES_LIST)
    expect(messages().at(-1).result.resources.length).toBeGreaterThan(0)
    await call(P.METHOD_RESOURCES_TEMPLATES_LIST)
    expect(messages().at(-1).result.resourceTemplates).toHaveLength(1)
    await call(P.METHOD_COC_STATUS)
    expect(messages().at(-1).result).toBeTruthy()
    await call(P.METHOD_PING)
    expect(messages().at(-1).result).toEqual({})
    await call(P.METHOD_LOGGING_SET_LEVEL, { level: 'warning' }, undefined)
    expect(session.logLevel).toBe('warning')
    await call(P.NOTIFICATION_ROOTS_LIST_CHANGED, {}, undefined)
    expect(session.roots).toEqual([])
    await call(P.METHOD_COC_SUBSCRIBE, {})
    expect(messages().at(-1).result.subscribed).toEqual([])
    await call(P.METHOD_COC_UNSUBSCRIBE, {})
    expect(messages().at(-1).result.unsubscribed).toEqual([])
  })

  it('handles notifications without sending responses', async () => {
    initializeSession()
    for (let method of [P.METHOD_TOOLS_LIST, P.METHOD_TOOLS_CALL, P.METHOD_ROOTS_LIST,
      P.METHOD_COC_STATUS, P.METHOD_COC_SUBSCRIBE, P.METHOD_COC_UNSUBSCRIBE,
      P.METHOD_RESOURCES_LIST, P.METHOD_RESOURCES_TEMPLATES_LIST, P.METHOD_RESOURCES_READ]) {
      await handleMessage(server, session, { jsonrpc: '2.0', method, params: {} })
    }
    expect(messages()).toHaveLength(0)
  })

  it('filters legacy tool metadata and handles shutdown notifications', async () => {
    initializeSession()
    session.protocolVersion = '2024-11-05'
    await handleMessage(server, session, { jsonrpc: '2.0', id: 1, method: P.METHOD_TOOLS_LIST })
    expect(messages()[0].result.tools[0]).toEqual(expect.objectContaining({ name: 'primitive' }))
    expect(messages()[0].result.tools[0].annotations).toBeUndefined()
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_SHUTDOWN })
    expect(session.shutdown).toBe(true)
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.NOTIFICATION_EXIT })
    expect(session.active).toBe(false)
  })

  it('returns resource-not-found and applies rate limiting', async () => {
    initializeSession()
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_RESOURCES_READ, params: { uri: 'coc://missing' }
    })
    expect(messages()[0].error.code).toBe(P.COC_RESOURCE_NOT_FOUND)
    server.options.maxRequestsPerSecond = 1
    await handleMessage(server, session, { jsonrpc: '2.0', id: 2, method: P.METHOD_PING })
    expect(messages()[1].error.message).toContain('Rate limit')
  })

  it('validates unknown and malformed tool calls for both protocol revisions', async () => {
    initializeSession()
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_TOOLS_CALL, params: { name: 'unknown' }
    })
    expect(messages()[0].error.message).toContain('Unknown tool')
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 2, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive', arguments: [] }
    })
    expect(messages()[1].error.code).toBe(P.JSONRPC_INVALID_PARAMS)
    session.protocolVersion = '2025-11-25'
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 3, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive', arguments: null }
    })
    expect(messages()[2].result.isError).toBe(true)
  })

  it('rejects disallowed tools and saturated sessions', async () => {
    initializeSession()
    server.tools.setAllowedTools([])
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 1, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive' }
    })
    expect(messages()[0].error.message).toContain('not allowed')
    server.tools.setAllowedTools(null)
    session.inFlight = server.maxInFlight
    await handleMessage(server, session, {
      jsonrpc: '2.0', id: 2, method: P.METHOD_TOOLS_CALL, params: { name: 'primitive' }
    })
    expect(messages()[1].error.message).toContain('concurrent')
  })

  it('ignores shutdown and unknown notifications', async () => {
    initializeSession()
    session.shutdown = true
    await handleMessage(server, session, { jsonrpc: '2.0', method: P.METHOD_PING })
    await handleMessage(server, session, { jsonrpc: '2.0', method: 'unknown' })
    expect(messages()).toHaveLength(0)
  })
})
