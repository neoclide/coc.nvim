'use strict'
import net from 'net'
import { encodeMessage, FrameSplitter } from '../../mcp/framing'

/**
 * Minimal MCP test client over a real TCP socket for mcp tests.
 */
export class TestClient {
  public socket: net.Socket
  public notifications: any[] = []
  private splitter: FrameSplitter
  private waiters = new Map<number | string, { resolve: (msg: any) => void, reject: (err: Error) => void }>()
  private listeners: Array<{ method: string, resolve: (msg: any) => void, reject: (err: Error) => void, timer: NodeJS.Timeout }> = []
  private closed = false
  private closePromise: Promise<void>
  private resolveClose: () => void

  constructor(portOrPath: number | string, host = '127.0.0.1') {
    this.socket = typeof portOrPath === 'string'
      ? net.createConnection(portOrPath)
      : net.createConnection({ port: portOrPath, host })
    this.socket.setNoDelay(true)
    this.resolveClose = () => {}
    this.closePromise = new Promise(resolve => {
      this.resolveClose = resolve
    })
    this.splitter = new FrameSplitter(1 << 20, msg => this.onFrame(msg), () => {})
    this.socket.on('data', chunk => this.splitter.push(chunk))
    this.socket.on('close', () => {
      this.closed = true
      for (let waiter of this.waiters.values()) {
        waiter.reject(new Error('Connection closed'))
      }
      this.waiters.clear()
      for (let listener of this.listeners) {
        clearTimeout(listener.timer)
        listener.reject(new Error('Connection closed'))
      }
      this.listeners = []
      this.resolveClose()
    })
    this.socket.on('error', () => {})
  }

  public send(msg: any): void {
    this.socket.write(encodeMessage(msg))
  }

  public request(id: number | string, method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject })
      let msg: any = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params
      this.send(msg)
    })
  }

  public notify(method: string, params?: any): void {
    let msg: any = { jsonrpc: '2.0', method }
    if (params !== undefined) msg.params = params
    this.send(msg)
  }

  public waitNotification(method: string, timeout = 3000): Promise<any> {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        let index = this.listeners.findIndex(l => l.method === method)
        if (index !== -1) this.listeners.splice(index, 1)
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeout)
      this.listeners.push({ method, resolve, reject, timer })
      this.checkQueued()
    })
  }

  public onClosed(): Promise<void> {
    return this.closePromise
  }

  public close(): void {
    if (!this.closed) this.socket.destroy()
  }

  private onFrame(msg: any): void {
    if (msg.id !== undefined && this.waiters.has(msg.id)) {
      let waiter = this.waiters.get(msg.id)!
      this.waiters.delete(msg.id)
      if (msg.error) waiter.reject(new Error(`${msg.error.code}: ${msg.error.message}`))
      else waiter.resolve(msg.result)
      return
    }
    if (msg.id === undefined) {
      this.notifications.push(msg)
      this.checkQueued()
      return
    }
    this.notifications.push(msg)
  }

  private checkQueued(): void {
    for (let listener of this.listeners) {
      let index = this.notifications.findIndex(n => n.method === listener.method)
      if (index === -1) continue
      let msg = this.notifications.splice(index, 1)[0]
      clearTimeout(listener.timer)
      let i = this.listeners.indexOf(listener)
      if (i !== -1) this.listeners.splice(i, 1)
      listener.resolve(msg)
    }
  }
}
