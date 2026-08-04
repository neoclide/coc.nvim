'use strict'

/**
 * MCP protocol constants shared by the socket server and tools.
 *
 * Target: Model Context Protocol 2025-06-18.
 * @see https://modelcontextprotocol.io/specification/2025-06-18/
 */

export const PROTOCOL_VERSION = '2025-06-18'
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18']

export const DEFAULT_FRAME_MAX_BYTES = 16 * 1024 * 1024
export const DEFAULT_TOOL_TIMEOUT = 5000
export const DEFAULT_READ_TIMEOUT = 15000
export const AUTH_TIMEOUT = 5000
export const MAX_IN_FLIGHT = 16

// MCP lifecycle
export const METHOD_INITIALIZE = 'initialize'
export const METHOD_SHUTDOWN = 'shutdown'
export const NOTIFICATION_INITIALIZED = 'notifications/initialized'
export const NOTIFICATION_EXIT = 'notifications/exit'
export const METHOD_PING = 'ping'

// MCP tools
export const METHOD_TOOLS_LIST = 'tools/list'
export const METHOD_TOOLS_CALL = 'tools/call'
export const NOTIFICATION_TOOLS_LIST_CHANGED = 'notifications/tools/list_changed'

// MCP logging
export const METHOD_LOGGING_SET_LEVEL = 'logging/setLevel'
export const NOTIFICATION_MESSAGE = 'notifications/message'

// MCP roots
export const METHOD_ROOTS_LIST = 'roots/list'
export const NOTIFICATION_ROOTS_LIST_CHANGED = 'notifications/roots/list_changed'

// MCP cancellation & progress
export const NOTIFICATION_CANCELLED = 'notifications/cancelled'
export const NOTIFICATION_PROGRESS = 'notifications/progress'

// Resources/prompts are not implemented in Phase 1 but kept for capability
// negotiation and clear -32601 responses.
export const METHOD_RESOURCES_LIST = 'resources/list'
export const METHOD_RESOURCES_READ = 'resources/read'
export const METHOD_RESOURCES_TEMPLATES_LIST = 'resources/templates/list'
export const METHOD_PROMPTS_LIST = 'prompts/list'
export const METHOD_PROMPTS_GET = 'prompts/get'

// coc.nvim extensions (custom transport extension, documented in .codex/mcp.md)
export const METHOD_COC_AUTH = 'coc/auth'
export const METHOD_COC_STATUS = 'coc/status'
export const METHOD_COC_SUBSCRIBE = 'coc/subscribe'
export const METHOD_COC_UNSUBSCRIBE = 'coc/unsubscribe'
export const METHOD_COC_CHALLENGE = 'coc/challenge'

// JSON-RPC 2.0 error codes
export const JSONRPC_PARSE_ERROR = -32700
export const JSONRPC_INVALID_REQUEST = -32600
export const JSONRPC_METHOD_NOT_FOUND = -32601
export const JSONRPC_INVALID_PARAMS = -32602
export const JSONRPC_INTERNAL_ERROR = -32603

// MCP/coc extension error codes
export const COC_AUTH_FAILED = -32001
export const COC_RESOURCE_NOT_FOUND = -32002
export const COC_REQUEST_TIMEOUT = -32003
export const COC_SESSION_CLOSED = -32800

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string
  method: string
  params?: any
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: any
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: any
  error?: JsonRpcError
}

export interface JsonRpcError {
  code: number
  message: string
  data?: any
}

export interface ServerCapabilities {
  tools?: { listChanged?: boolean }
  resources?: { subscribe?: boolean, listChanged?: boolean }
  prompts?: Record<string, never>
  logging?: Record<string, never>
  experimental?: Record<string, unknown>
}

export interface ServerInfo {
  name: string
  version: string
  description?: string
}
