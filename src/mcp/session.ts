'use strict'
import { Socket } from 'net'
import { AUTH_TIMEOUT, JsonRpcError } from './protocol'
import { encodeMessage } from './framing'
import { createLogger } from '../logger'
const logger = createLogger('mcp-session')

let sessionId = 0

export class Session {
  public readonly id: number
  public authenticated = false
  public initialized = false
  public shutdown = false
  public protocolVersion: string | undefined
  public clientInfo: any
  public nonce: string | undefined
  public roots: string[] = []
  public readonly subscriptions = new Set<string>()
  public logLevel = 'info'
  public inFlight = 0
  public readonly pending = new Map<number | string, { cancel(): void, timer?: NodeJS.Timeout }>()
  public readonly createdAt = Date.now()
  public lastActiveAt = Date.now()
  private requestTimes: number[] = []
  private queue: Promise<void> = Promise.resolve()
  private authTimer: NodeJS.Timeout | undefined
  private idleTimer: NodeJS.Timeout | undefined
  private closed = false

  constructor(
    private socket: Socket,
    private onClose: (session: Session) => void,
    private authTimeout = AUTH_TIMEOUT,
    private idleTimeout = 0
  ) {
    this.id = ++sessionId
    if (this.authTimeout > 0) {
      this.authTimer = setTimeout(() => {
        if (!this.authenticated) {
          logger.warn(`Session ${this.id} not authenticated within ${authTimeout}ms, closing`)
          this.close()
        }
      }, authTimeout)
    }
  }

  public get active(): boolean {
    return !this.closed
  }

  /**
   * Run a request handler after all previously queued requests. Requests
   * (and the exit notification) are processed in order so that shutdown/exit
   * cannot cut off an in-flight tool call. Notifications such as
   * notifications/cancelled are handled out of band and must not be queued.
   * Once the session is closed, tasks that have not started yet are dropped:
   * close is the session's execution boundary.
   */
  public enqueue(task: () => Promise<void>): void {
    let run = (): Promise<void> | undefined => {
      if (this.closed) return
      return task()
    }
    // Run the current task from either branch: a rejected previous task must
    // not consume and silently drop the next queued request.
    this.queue = this.queue.then(run, run)
  }

  public touch(): void {
    this.lastActiveAt = Date.now()
    if (this.closed || this.idleTimeout <= 0) return
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      logger.info(`Session ${this.id} idle timeout, closing`)
      this.close()
    }, this.idleTimeout)
  }

  /**
   * Sliding-window per-session request rate limit. Returns false when the
   * session exceeded `limitPerSecond` requests in the last second.
   */
  public checkRateLimit(limitPerSecond: number): boolean {
    if (limitPerSecond <= 0) return true
    let now = Date.now()
    let windowStart = now - 1000
    this.requestTimes = this.requestTimes.filter(t => t > windowStart)
    if (this.requestTimes.length >= limitPerSecond) return false
    this.requestTimes.push(now)
    return true
  }

  public send(msg: any): void {
    if (this.closed) return
    try {
      this.socket.write(encodeMessage(msg))
    } catch (e) {
      logger.error(`Session ${this.id} failed to write`, e)
      this.close()
    }
  }

  public sendResult(id: number | string | null, result: any): void {
    this.send({ jsonrpc: '2.0', id, result })
  }

  public sendError(id: number | string | null, code: number, message: string, data?: any): void {
    let error: JsonRpcError = { code, message }
    if (data !== undefined) error.data = data
    this.send({ jsonrpc: '2.0', id, error })
  }

  public sendNotification(method: string, params?: any): void {
    let msg: any = { jsonrpc: '2.0', method }
    if (params !== undefined) msg.params = params
    this.send(msg)
  }

  public close(): void {
    if (this.closed) return
    this.closed = true
    if (this.authTimer) clearTimeout(this.authTimer)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    // Cancel every in-flight request token and clear the bookkeeping; queued
    // tasks that have not started yet are skipped by enqueue(). Late results
    // are consumed by the callers and never sent (send() ignores closed).
    for (let pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.cancel()
    }
    this.pending.clear()
    this.onClose(this)
    try {
      this.socket.end()
    } catch (_e) {
      // ignore
    }
  }
}
