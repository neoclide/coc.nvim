'use strict'
import { createLogger } from '../logger'
import { toErrorText } from '../util/string'
import { crypto } from '../util/node'
import { CancellationTokenSource } from '../util/protocol'
import * as P from './protocol'
import { ResourceNotFoundError } from './resources'
import type { McpServer } from './server'
import type { Session } from './session'
import type { McpToolResult } from './tools'
const logger = createLogger('mcp-dispatcher')

class ToolTimeoutError extends Error {}

function logAudit(session: Session, message: string): void {
  if (session.logLevel === 'debug' || session.logLevel === 'info') {
    logger.info(`[audit] session ${session.id}: ${message}`)
  }
}

function normalizeResult(result: any, protocolVersion: string | undefined): any {
  if (
    result &&
    Array.isArray(result.content) &&
    result.content.every((c: any) => c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string')
  ) {
    if (!P.supportsStructuredContent(protocolVersion) && 'structuredContent' in result) {
      let { structuredContent: _sc, ...rest } = result
      return rest
    }
    return result
  }
  let text = typeof result === 'string' ? result : JSON.stringify(result ?? {})
  let normalized: any = {
    content: [{ type: 'text', text }],
    isError: false
  }
  // structuredContent only exists in 2025-06-18+; 2024-11-05 results are
  // limited to content/isError.
  if (P.supportsStructuredContent(protocolVersion)) normalized.structuredContent = result
  return normalized
}

function handleInitialize(server: McpServer, session: Session, id: number | string | null, params: any): void {
  let protocolVersion = params?.protocolVersion
  if (typeof protocolVersion !== 'string' || !P.SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
    session.sendError(
      id,
      P.JSONRPC_INVALID_REQUEST,
      `Unsupported protocol version ${JSON.stringify(protocolVersion)}, supported: ${P.SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`
    )
    return
  }
  session.protocolVersion = protocolVersion
  // keep the auth-time client identity (e.g. the bridge with its pid);
  // the agent's initialize clientInfo is not authoritative for the socket
  if (!session.clientInfo) session.clientInfo = params?.clientInfo
  session.initialized = true
  session.sendResult(id, {
    protocolVersion,
    capabilities: server.capabilities(),
    serverInfo: server.serverInfo(),
    instructions: 'coc.nvim MCP server. Use workspace/info to inspect the editor state.'
  })
}

async function handleToolCall(server: McpServer, session: Session, id: number | string | null, params: any): Promise<void> {
  let name = params?.name
  if (typeof name !== 'string') {
    session.sendError(id, P.JSONRPC_INVALID_PARAMS, 'Tool name is required')
    return
  }
  if (!server.tools.has(name)) {
    let message = server.tools.isAllowed(name)
      ? `Unknown tool: ${name}`
      : `Tool not allowed by mcp.allowedTools: ${name}`
    session.sendError(id, P.JSONRPC_INVALID_PARAMS, message)
    return
  }
  let args = params?.arguments
  if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
    let message = 'Tool arguments must be an object'
    if (session.protocolVersion === '2025-11-25') {
      // SEP-1303: input validation errors are Tool Execution Errors, not protocol errors
      session.sendResult(id, {
        content: [{ type: 'text', text: message }],
        isError: true
      })
    } else {
      session.sendError(id, P.JSONRPC_INVALID_PARAMS, message)
    }
    return
  }
  if (session.inFlight >= server.maxInFlight) {
    session.sendError(id, P.JSONRPC_INTERNAL_ERROR, 'Too many concurrent requests')
    return
  }
  let tool = server.tools.get(name)
  let tokenSource = new CancellationTokenSource()
  let start = Date.now()
  let done = false
  let cancelled = false
  let timer: NodeJS.Timeout | undefined
  // read-only tools (e.g. LSP queries) get the longer mcp.readTimeout;
  // mutating and other tools use mcp.timeout. Both are user-configured and
  // the agent cannot override them.
  let timeout = tool?.annotations?.readOnlyHint === true ? server.readTimeout : server.timeout
  const finish = (fn: () => void): void => {
    if (done) return
    done = true
    if (timer) clearTimeout(timer)
    session.pending.delete(id)
    session.inFlight--
    tokenSource.dispose()
    if (!cancelled) fn()
  }
  session.inFlight++
  try {
    let call = (): Promise<McpToolResult> => server.tools.call(name, args ?? {}, { token: tokenSource.token })
    let callPromise: Promise<McpToolResult> = tool?.annotations?.destructiveHint === true
      ? server.withWriteLock(call)
      : call()
    // late results/rejections of an abandoned (timed out) call are ignored
    callPromise.catch(() => {})
    let resultPromise: Promise<McpToolResult>
    if (timeout > 0) {
      // Race the call against the timeout so a hung tool cannot block the
      // session queue. The token is cancelled (LSP requests get
      // $/cancelRequest); the per-service limiter drops queued LSP requests
      // and tracks abandoned running ones as stuck, failing fast once the
      // server is saturated, so abandoned calls cannot pile up in the
      // language client.
      resultPromise = Promise.race([
        callPromise,
        new Promise<McpToolResult>((_, reject) => {
          timer = setTimeout(() => {
            tokenSource.cancel()
            reject(new ToolTimeoutError(String(timeout)))
          }, timeout)
        })
      ])
    } else {
      resultPromise = callPromise
    }
    // set pending after the timer so cancelRequest can clear it. Cancellation
    // terminates the protocol-side accounting (inFlight, token, pending) even
    // when the tool itself ignores the token and never settles; late results
    // are consumed by finish() without a second response.
    session.pending.set(id, {
      cancel: () => {
        cancelled = true
        tokenSource.cancel()
        finish(() => {})
      },
      timer
    })
    let result = await resultPromise
    finish(() => {
      logAudit(session, `Tool ${name} finished in ${Date.now() - start}ms`)
      session.sendResult(id, normalizeResult(result, session.protocolVersion))
    })
  } catch (e) {
    finish(() => {
      if (e instanceof ToolTimeoutError) {
        logAudit(session, `Tool ${name} timed out after ${timeout}ms`)
        session.sendError(id, P.COC_REQUEST_TIMEOUT, `Tool ${name} timed out after ${timeout}ms`)
      } else {
        logAudit(session, `Tool ${name} failed after ${Date.now() - start}ms: ${toErrorText(e)}`)
        logger.error(`Tool ${name} failed`, e)
        session.sendError(id, P.JSONRPC_INTERNAL_ERROR, `Tool ${name} failed: ${toErrorText(e)}`)
      }
    })
  }
}

export async function handleMessage(server: McpServer, session: Session, msg: any): Promise<void> {
  if (!session.active) return
  session.touch()
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    session.sendError(msg && typeof msg.id !== 'undefined' ? msg.id : null, P.JSONRPC_INVALID_REQUEST, 'Invalid message')
    return
  }
  let { id, method, params } = msg
  let isNotification = typeof id === 'undefined'
  let isRequest = !isNotification
  if (method === P.METHOD_COC_CHALLENGE) {
    // pre-auth, no token needed: issue a single-use nonce for signature auth
    session.nonce = crypto.randomBytes(32).toString('hex')
    if (isRequest) session.sendResult(id, { nonce: session.nonce })
    return
  }
  if (method === P.METHOD_COC_AUTH) {
    if (session.authenticated) {
      if (isRequest) session.sendError(id, P.JSONRPC_INVALID_REQUEST, 'Already authenticated')
      return
    }
    let authParams = params ?? {}
    if (server.options.authClientPublicKey) {
      // public-key auth (mcp.authClientPublicKey) replaces the token:
      // possession of the private key, proved by signing the server-issued
      // nonce, is the authentication. This lets the bridge connect over a
      // forwarded SSH port without ever copying the token-bearing discovery
      // file to the local machine.
      let nonce = authParams.nonce
      let signature = authParams.signature
      if (typeof nonce !== 'string' || nonce !== session.nonce || typeof signature !== 'string') {
        session.nonce = undefined
        if (isRequest) session.sendError(id, P.COC_AUTH_FAILED, 'Signature challenge mismatch')
        session.close()
        return
      }
      let valid = false
      try {
        valid = crypto.verify('sha256', Buffer.from(nonce), server.options.authClientPublicKey, Buffer.from(signature, 'base64'))
      } catch (_e) {
        valid = false
      }
      session.nonce = undefined
      if (!valid) {
        if (isRequest) session.sendError(id, P.COC_AUTH_FAILED, 'Signature verification failed')
        session.close()
        return
      }
    } else {
      if (authParams.token !== server.options.token) {
        if (isRequest) session.sendError(id, P.COC_AUTH_FAILED, 'Invalid token')
        session.close()
        return
      }
    }
    session.authenticated = true
    session.clientInfo = authParams.clientInfo
    if (isRequest) {
      session.sendResult(id, {
        ok: true,
        protocolVersion: P.PROTOCOL_VERSION,
        serverInfo: server.serverInfo(),
        capabilities: server.capabilities(),
        extensions: ['coc/auth', 'coc/status']
      })
    }
    return
  }
  if (!session.authenticated) {
    if (isRequest) session.sendError(id, P.COC_AUTH_FAILED, 'Not authenticated')
    session.close()
    return
  }
  if (!session.initialized) {
    if (method === P.METHOD_INITIALIZE && isRequest) {
      handleInitialize(server, session, id, params)
      return
    }
    if (method === P.METHOD_PING) {
      if (isRequest) session.sendResult(id, {})
      return
    }
    if (isRequest) session.sendError(id, P.JSONRPC_INVALID_REQUEST, 'Server not initialized')
    return
  }
  if (session.shutdown && method !== P.NOTIFICATION_EXIT) {
    if (isRequest) session.sendError(id, P.COC_SESSION_CLOSED, 'Server is shutting down')
    return
  }
  if (isRequest && !session.checkRateLimit(server.maxRequestsPerSecond)) {
    session.sendError(id, P.JSONRPC_INTERNAL_ERROR, 'Rate limit exceeded, slow down')
    return
  }
  switch (method) {
    case P.METHOD_SHUTDOWN:
      session.shutdown = true
      if (isRequest) session.sendResult(id, null)
      return
    case P.NOTIFICATION_EXIT:
      session.close()
      return
    case P.METHOD_PING:
      if (isRequest) session.sendResult(id, {})
      return
    case P.NOTIFICATION_INITIALIZED:
      return
    case P.METHOD_TOOLS_LIST:
      if (isRequest) {
        let { tools } = server.tools.list()
        // 2024-11-05 Tool is limited to name/description/inputSchema:
        // title, annotations and outputSchema only exist in newer revisions.
        if (!P.supportsToolMetadata(session.protocolVersion)) {
          tools = tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
        }
        session.sendResult(id, { tools })
      }
      return
    case P.METHOD_TOOLS_CALL:
      if (isRequest) await handleToolCall(server, session, id, params)
      return
    case P.METHOD_LOGGING_SET_LEVEL:
      session.logLevel = typeof params?.level === 'string' ? params.level : 'info'
      if (isRequest) session.sendResult(id, null)
      return
    case P.METHOD_ROOTS_LIST:
      if (isRequest) session.sendResult(id, { roots: session.roots.map(uri => ({ uri })) })
      return
    case P.NOTIFICATION_ROOTS_LIST_CHANGED:
      session.roots = Array.isArray(params?.roots)
        ? params.roots.map((r: any) => r?.uri).filter((u: any) => typeof u === 'string')
        : []
      return
    case P.NOTIFICATION_CANCELLED:
      server.cancelRequest(session, params?.requestId)
      return
    case P.NOTIFICATION_PROGRESS:
      return
    case P.METHOD_COC_STATUS:
      if (isRequest) session.sendResult(id, server.status())
      return
    case P.METHOD_COC_SUBSCRIBE:
      if (isRequest) {
        let events = Array.isArray(params?.events)
          ? params.events.filter((e: any) => typeof e === 'string' && e.startsWith('coc/'))
          : []
        for (let event of events) session.subscriptions.add(event)
        session.sendResult(id, { subscribed: events })
      }
      return
    case P.METHOD_COC_UNSUBSCRIBE:
      if (isRequest) {
        let events = Array.isArray(params?.events)
          ? params.events.filter((e: any) => typeof e === 'string')
          : []
        for (let event of events) session.subscriptions.delete(event)
        session.sendResult(id, { unsubscribed: events })
      }
      return
    case P.METHOD_RESOURCES_LIST:
      if (isRequest) session.sendResult(id, server.resources.listResources())
      return
    case P.METHOD_RESOURCES_TEMPLATES_LIST:
      if (isRequest) session.sendResult(id, server.resources.listTemplates())
      return
    case P.METHOD_RESOURCES_READ:
      if (isRequest) {
        let resourceUri = params?.uri
        if (typeof resourceUri !== 'string') {
          session.sendError(id, P.JSONRPC_INVALID_PARAMS, 'uri is required')
          return
        }
        try {
          let result = await server.resources.read(resourceUri)
          session.sendResult(id, result)
        } catch (e) {
          if (e instanceof ResourceNotFoundError) {
            session.sendError(id, P.COC_RESOURCE_NOT_FOUND, e.message)
          } else {
            logger.error(`Failed to read resource ${resourceUri}`, e)
            session.sendError(id, P.JSONRPC_INTERNAL_ERROR, `Failed to read resource: ${toErrorText(e)}`)
          }
        }
      }
      return
    default:
      if (isRequest) session.sendError(id, P.JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`)
  }
}
