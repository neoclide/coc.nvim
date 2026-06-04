import { NeovimClient } from '../api'
import { isCocNvim } from '../utils/constants'
import { ILogger } from '../utils/logger'
import Transport, { Response } from './base'
import Connection, { VimCommands } from './connection'
import Request from './request'
const notifyMethod = isCocNvim ? 'coc#api#Notify' : 'nvim#api#Notify'

export class VimTransport extends Transport {
  private pending: Map<number, Request> = new Map()
  private nextRequestId = -1
  private connection: Connection
  private attached = false
  private client: NeovimClient
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
        if (req.isDirect) {
          result = obj
        } else {
          if (!Array.isArray(obj)) {
            err = obj
          } else {
            err = obj[0]
            result = obj[1]
          }
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

  public vimCommand(command: VimCommands, ...args: any[]): void {
    switch (command) {
      case 'expr':
        this.connection.expr(args[0])
        break
      case 'call':
        this.connection.call(args[0], args[1])
        break
      case 'ex':
        this.connection.ex(args[0])
        break
      case 'redraw':
        this.connection.redraw(args[0])
        break
      default:
        throw new Error(`command "${command}" not exists`)
    }
  }

  public vimRequest(command: 'call' | 'eval', args: any[]): Promise<any> {
    if (!this.attached) return Promise.reject(new Error('transport disconnected'))
    Error.captureStackTrace(args)
    let id = this.nextRequestId
    this.nextRequestId = this.nextRequestId - 1
    return new Promise((resolve, reject) => {
      let req = new Request(this.connection, (err, res) => {
        if (!err && res === 'ERROR') {
          if (command === 'eval') {
            err = new Error(`Invalid expression "${args[0]}", checkout v:errmsg`)
          } else {
            err = new Error(`Error on function "${args[0]}", checkout v:errmsg"`)
          }
        }
        if (err) {
          err.stack = `Error: vim "${command}" error - ${err}\n` + args['stack'].split(/\r?\n/).slice(3).join('\n')
          this.client.logError(`Error on vim command "${command}"`, args, err)
          reject(err instanceof Error ? err : new Error(String(err)))
          return
        }
        resolve(res)
      }, id)
      this.pending.set(id, req)
      if (command === 'call') {
        req.call(args[0], args[1])
      } else {
        req.expr(args[0])
      }
    })
  }

  /**
   * Send request to vim
   */
  public request(method: string, args: any[], cb: (...args: any[]) => any): any {
    if (!this.attached) return cb([0, 'transport disconnected'])
    let id = this.nextRequestId
    this.nextRequestId = this.nextRequestId - 1
    let req = new Request(this.connection, (err, res) => {
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
        this.connection.call(notifyMethod, [fname, [text]])
      }
      return
    }
    if (fname == 'err_writeln') {
      let text = this.errText + args[0].toString()
      this.errText = ''
      this.connection.call(notifyMethod, [fname, [text]])
      return
    }
    this.connection.call(notifyMethod, [fname, args])
  }

  protected createResponse(_method: string, requestId: number): Response {
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
