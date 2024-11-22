import { NeovimClient } from '../api'
import { isCocNvim } from '../utils/constants'
import { ILogger } from '../utils/logger'
import Transport, { Response } from './base'
import Connection from './connection'
import Request from './request'

export class VimTransport extends Transport {
  private pending: Map<number, Request> = new Map()
  private nextRequestId = -1
  private connection: Connection
  private attached = false
  private client: NeovimClient
  private notifyMethod: string
  /**
   * Cached error message
   */
  private errText = ''
  /**
   * Cached out message
   */
  private outText = ''

  constructor(logger: ILogger) {
    super(logger, true)
    this.notifyMethod = isCocNvim ? 'coc#api#notify' : 'nvim#api#notify'
  }

  public attach(
    writer: NodeJS.WritableStream,
    reader: NodeJS.ReadableStream,
    client: NeovimClient
  ): void {
    let connection = this.connection = new Connection(reader, writer)
    this.attached = true
    this.client = client

    connection.on('request', (id: number, obj: any) => {
      let [method, args] = obj
      this.emit(
        'request',
        method,
        args,
        this.createResponse(method, id)
      )
    })
    connection.on('notification', (obj: any) => {
      let [event, args] = obj
      this.emit('notification', event.toString(), args)
    })
    connection.on('response', (id: number, obj: any) => {
      let req = this.pending.get(id)
      if (req) {
        this.pending.delete(id)
        let err = null
        let result = null
        if (!Array.isArray(obj)) {
          err = obj
        } else {
          err = obj[0]
          result = obj[1]
        }
        req.callback(this.client, err, result)
      }
    })
  }

  public send(arr: any[]): void {
    this.connection.send(arr)
  }

  public detach(): void {
    if (!this.attached) return
    this.attached = false
    this.connection.dispose()
    for (let req of this.pending.values()) {
      req.callback(this.client, 'connection disconnected', null)
    }
    this.pending.clear()
  }

  /**
   * Send request to vim
   */
  public request(method: string, args: any[], cb: Function): any {
    if (!this.attached) return cb([0, 'transport disconnected'])
    let id = this.nextRequestId
    this.nextRequestId = this.nextRequestId - 1
    // let startTs = Date.now()
    // if (debug) this.debug(`Send request "${method}" (${id}) to vim: `, args)
    let req = new Request(this.connection, (err, res) => {
      // if (debug) this.debug(`Receive response "${method}" (${id}) from vim ${Date.now() - startTs}ms`, err ?? res)
      cb(err, res)
    }, id)
    this.pending.set(id, req)
    req.request(method, args)
  }

  public notify(method: string, args: any[]): void {
    if (!this.attached) return
    if (this.pauseLevel != 0) {
      let arr = this.paused.get(this.pauseLevel)
      if (arr) {
        arr.push([method, args])
        return
      }
    }
    let fname = method.slice(5)
    if (fname == 'err_write') {
      this.errText = this.errText + args[0].toString()
      return
    }
    if (fname == 'out_write') {
      let msg = args[0].toString() || ''
      if (!msg.includes('\n')) {
        this.outText = this.outText + msg
      } else {
        let text = this.outText + args[0].toString()
        this.outText = ''
        this.connection.call(this.notifyMethod, [fname, [text]])
      }
      return
    }
    if (fname == 'err_writeln') {
      let text = this.errText + args[0].toString()
      this.errText = ''
      this.connection.call(this.notifyMethod, [fname, [text]])
      return
    }
    this.connection.call(this.notifyMethod, [fname, args])
  }

  protected createResponse(method: string, requestId: number): Response {
    let called = false
    let { connection } = this
    // let startTs = Date.now()
    return {
      send: (resp: any, isError?: boolean): void => {
        if (called || !this.attached) return
        called = true
        let err: string = null
        if (isError) err = typeof resp === 'string' ? resp : resp.toString()
        // if (debug) this.debug(`Send "${method}" (${requestId}) response to vim ${Date.now() - startTs}ms`)
        connection.response(requestId, [err, isError ? null : resp])
      }
    }
  }
}
