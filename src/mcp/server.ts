'use strict'
import type { AddressInfo, Server, Socket } from 'net'
import { createLogger } from '../logger'
import { VERSION } from '../util/constants'
import { Mutex } from '../util/mutex'
import { net } from '../util/node'
import { Disposable } from '../util/protocol'
import { handleMessage } from './dispatcher'
import { FrameError, FrameSplitter } from './framing'
import {
  AUTH_TIMEOUT,
  DEFAULT_FRAME_MAX_BYTES,
  DEFAULT_READ_TIMEOUT,
  DEFAULT_TOOL_TIMEOUT,
  JSONRPC_PARSE_ERROR,
  MAX_IN_FLIGHT,
  NOTIFICATION_TOOLS_LIST_CHANGED,
  PROTOCOL_VERSION,
  ServerCapabilities,
  ServerInfo
} from './protocol'
import { Session } from './session'
import { ToolRegistry } from './tools'
import { ResourceManager } from './resources'
const logger = createLogger('mcp-server')

export interface McpServerOptions {
  transport: 'tcp' | 'unix'
  host: string
  port: number
  socketPath?: string
  token: string
  authRequired: boolean
  maxClients: number
  frameMaxBytes?: number
  timeout?: number
  idleTimeout?: number
  maxRequestsPerSecond?: number
  authClientPublicKey?: string
  readTimeout?: number
}

export interface McpServerAddress {
  host: string
  port: number
  socketPath: string
}

export class McpServer implements Disposable {
  public readonly tools: ToolRegistry
  public readonly resources: ResourceManager
  private readonly ownsTools: boolean
  private server: Server | undefined
  private sessions = new Map<number, Session>()
  private address: McpServerAddress | undefined
  private disposed = false
  private writeMutex = new Mutex()

  constructor(
    public readonly options: McpServerOptions,
    tools?: ToolRegistry,
    resources?: ResourceManager
  ) {
    this.ownsTools = tools === undefined
    this.tools = tools ?? new ToolRegistry()
    this.resources = resources ?? new ResourceManager()
    this.tools.onDidChange(() => {
      this.broadcastNotification(NOTIFICATION_TOOLS_LIST_CHANGED, undefined)
    })
  }

  public get authRequired(): boolean {
    return this.options.authRequired
  }

  public get timeout(): number {
    return this.options.timeout ?? DEFAULT_TOOL_TIMEOUT
  }

  public get readTimeout(): number {
    return this.options.readTimeout ?? DEFAULT_READ_TIMEOUT
  }

  public get maxInFlight(): number {
    return MAX_IN_FLIGHT
  }

  public get maxRequestsPerSecond(): number {
    return this.options.maxRequestsPerSecond ?? 60
  }

  public serverInfo(): ServerInfo {
    return { name: 'coc.nvim', version: VERSION, description: 'coc.nvim MCP server' }
  }

  public capabilities(): ServerCapabilities {
    return {
      tools: { listChanged: true },
      resources: { subscribe: false, listChanged: false },
      logging: {}
    }
  }

  public listen(): Promise<McpServerAddress> {
    return new Promise((resolve, reject) => {
      let server = net.createServer(socket => {
        this.handleConnection(socket)
      })
      server.on('error', err => {
        logger.error('MCP server error', err)
        reject(err)
      })
      if (this.options.transport === 'unix') {
        let socketPath = this.options.socketPath
        if (!socketPath) {
          reject(new Error('socketPath is required for unix transport'))
          return
        }
        server.listen(socketPath, () => {
          this.server = server
          this.address = { host: 'unix', port: 0, socketPath }
          resolve(this.address)
        })
      } else {
        server.listen(this.options.port, this.options.host, () => {
          this.server = server
          let addr = server.address() as AddressInfo
          this.address = { host: this.options.host, port: addr.port, socketPath: '' }
          resolve(this.address)
        })
      }
    })
  }

  public status(): any {
    let clients = Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      pid: s.clientInfo && typeof s.clientInfo.pid === 'number' ? s.clientInfo.pid : null,
      name: s.clientInfo && typeof s.clientInfo.name === 'string' ? s.clientInfo.name : null,
      version: s.clientInfo && typeof s.clientInfo.version === 'string' ? s.clientInfo.version : null,
      connectedAt: s.createdAt,
      lastActiveAt: s.lastActiveAt
    }))
    return {
      running: !this.disposed,
      transport: this.options.transport,
      host: this.address?.host ?? this.options.host,
      port: this.address?.port ?? this.options.port,
      socketPath: this.address?.socketPath ?? this.options.socketPath,
      clients,
      tools: this.tools.list().tools.map(t => t.name),
      protocolVersion: PROTOCOL_VERSION
    }
  }

  public cancelRequest(session: Session, requestId: any): void {
    if (requestId === undefined || requestId === null) return
    let pending = session.pending.get(requestId)
    if (pending) {
      pending.cancel()
    }
  }

  /**
   * Global write lock: mutating tool calls are serialized across all
   * sessions so concurrent clients cannot race edits on the same buffers.
   * Read-only tools run in parallel without the lock.
   */
  public withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.writeMutex.use(fn)
  }

  public broadcastNotification(method: string, params: any): void {
    for (let session of this.sessions.values()) {
      if (session.initialized && !session.shutdown) {
        session.sendNotification(method, params)
      }
    }
  }

  /**
   * Broadcast a `coc/*` event only to sessions that subscribed to it.
   */
  public broadcastEvent(event: string, params: any): void {
    for (let session of this.sessions.values()) {
      if (session.initialized && !session.shutdown && session.subscriptions.has(event)) {
        session.sendNotification(event, params)
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (let session of this.sessions.values()) {
      session.close()
    }
    this.sessions.clear()
    if (this.ownsTools) this.tools.dispose()
    let server = this.server
    this.server = undefined
    if (server) {
      server.close()
    }
  }

  private handleConnection(socket: Socket): void {
    if (this.disposed || this.sessions.size >= this.options.maxClients) {
      socket.destroy()
      return
    }
    let session = new Session(
      socket,
      s => {
        this.sessions.delete(s.id)
      },
      AUTH_TIMEOUT,
      this.options.idleTimeout ?? 0
    )
    if (!this.options.authRequired) session.authenticated = true
    this.sessions.set(session.id, session)
    let splitter = new FrameSplitter(
      this.options.frameMaxBytes ?? DEFAULT_FRAME_MAX_BYTES,
      msg => {
        if (!session.active) return
        let isRequest = typeof msg?.id !== 'undefined'
        let isExit = msg?.method === 'notifications/exit'
        if (isRequest || isExit) {
          // read-only tools/call run in parallel within a session; everything
          // else (mutating tools, lifecycle) stays ordered via the queue
          let parallel = false
          if (isRequest && msg?.method === 'tools/call' && typeof msg?.params?.name === 'string') {
            let tool = this.tools.get(msg.params.name)
            parallel = tool?.annotations?.readOnlyHint === true
          }
          if (parallel) {
            void handleMessage(this, session, msg)
          } else {
            session.enqueue(() => handleMessage(this, session, msg))
          }
        } else {
          void handleMessage(this, session, msg)
        }
      },
      err => {
        this.handleFrameError(session, err)
      }
    )
    socket.on('data', (chunk: Buffer) => {
      if (!session.active) {
        socket.destroy()
        return
      }
      splitter.push(chunk)
    })
    socket.on('error', err => {
      logger.error(`Session ${session.id} socket error`, err)
    })
    socket.on('close', () => {
      splitter.dispose()
      session.close()
    })
    logger.info(`MCP client connected, session ${session.id}, total ${this.sessions.size}`)
  }

  private handleFrameError(session: Session, err: FrameError): void {
    if (!session.active) return
    logger.warn(`Session ${session.id} frame error: ${err.message}`)
    let id: number | string | null = null
    if (err.raw) {
      try {
        let parsed = JSON.parse(err.raw) as any
        if (parsed && typeof parsed.id !== 'undefined') id = parsed.id
      } catch (_e) {
        let match = /"id"\s*:\s*(\d+)/.exec(err.raw)
        if (match) id = Number(match[1])
      }
    }
    session.sendError(id, JSONRPC_PARSE_ERROR, `Parse error: ${err.message}`)
  }
}
