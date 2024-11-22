/**
 * Handles attaching transport
 */
import { NvimTransport } from '../transport/nvim'
import { VimTransport } from '../transport/vim'
import { AtomicResult, VimValue } from '../types'
import { isCocNvim, isTester } from '../utils/constants'
import { ILogger } from '../utils/logger'
import { Buffer } from './Buffer'
import { Neovim } from './Neovim'
import { Tabpage } from './Tabpage'
import { Window } from './Window'
import { EventEmitter } from 'events'
import Transport from '../transport/base'

export type Callback = (err?: Error | null, res?: any) => void

const functionsOnVim = [
  'nvim_buf_attach',
  'nvim_get_mode',
  'nvim_list_runtime_paths',
  'nvim_win_del_var',
  'nvim_create_buf',
  'nvim_exec',
  'nvim_tabpage_list_wins',
  'nvim_buf_del_var',
  'nvim_buf_get_mark',
  'nvim_tabpage_set_var',
  'nvim_create_namespace',
  'nvim_win_get_position',
  'nvim_win_set_height',
  'nvim_call_atomic',
  'nvim_buf_detach',
  'nvim_buf_line_count',
  'nvim_set_current_buf',
  'nvim_set_current_dir',
  'nvim_get_var',
  'nvim_del_current_line',
  'nvim_win_set_width',
  'nvim_out_write',
  'nvim_win_is_valid',
  'nvim_set_current_win',
  'nvim_get_current_tabpage',
  'nvim_tabpage_is_valid',
  'nvim_set_var',
  'nvim_win_get_height',
  'nvim_win_get_buf',
  'nvim_win_get_width',
  'nvim_buf_set_name',
  'nvim_subscribe',
  'nvim_get_current_win',
  'nvim_feedkeys',
  'nvim_get_vvar',
  'nvim_tabpage_get_number',
  'nvim_get_current_buf',
  'nvim_win_get_option',
  'nvim_win_get_cursor',
  'nvim_get_current_line',
  'nvim_win_get_var',
  'nvim_buf_get_var',
  'nvim_set_current_tabpage',
  'nvim_buf_clear_namespace',
  'nvim_err_write',
  'nvim_del_var',
  'nvim_call_dict_function',
  'nvim_set_current_line',
  'nvim_get_api_info',
  'nvim_unsubscribe',
  'nvim_get_option',
  'nvim_get_option_value',
  'nvim_list_wins',
  'nvim_set_client_info',
  'nvim_win_set_cursor',
  'nvim_win_set_option',
  'nvim_eval',
  'nvim_tabpage_get_var',
  'nvim_buf_get_option',
  'nvim_tabpage_del_var',
  'nvim_buf_get_name',
  'nvim_list_bufs',
  'nvim_win_set_buf',
  'nvim_win_close',
  'nvim_command_output',
  'nvim_command',
  'nvim_tabpage_get_win',
  'nvim_win_set_var',
  'nvim_buf_add_highlight',
  'nvim_buf_set_var',
  'nvim_win_get_number',
  'nvim_strwidth',
  'nvim_buf_set_lines',
  'nvim_err_writeln',
  'nvim_buf_set_option',
  'nvim_list_tabpages',
  'nvim_set_option',
  'nvim_buf_get_lines',
  'nvim_buf_get_changedtick',
  'nvim_win_get_tabpage',
  'nvim_call_function',
  'nvim_buf_is_valid'
]

export class AsyncResponse {
  private finished = false
  constructor(public readonly requestId: number, private cb: Callback) {
  }

  public finish(err?: string | null, res?: any): void {
    if (this.finished) return
    this.finished = true
    if (err) {
      this.cb(new Error(err))
      return
    }
    this.cb(null, res)
  }
}

function applyMixins(derivedCtor: any, constructors: any[]) {
  constructors.forEach(baseCtor => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) ||
        Object.create(null)
      )
    })
  })
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface NeovimClient extends Neovim, EventEmitter {}

// eslint-disable-next-line no-redeclare, @typescript-eslint/no-unsafe-declaration-merging
export class NeovimClient extends Neovim {
  private _isReady: Promise<boolean>
  private requestId = 1
  private responses: Map<number, AsyncResponse> = new Map()
  private _channelId: number
  private attachedBuffers: Map<number, Map<string, Function[]>> = new Map()
  public _transport: Transport

  constructor(private logger: ILogger, public readonly isVim: boolean) {
    // Neovim has no `data` or `metadata`
    super({})
    this._transport = isVim ? new VimTransport(logger) : new NvimTransport(logger)
    this.handleRequest = this.handleRequest.bind(this)
    this.handleNotification = this.handleNotification.bind(this)
  }

  protected get transport(): Transport {
    return this._transport
  }

  public echoError(msg: unknown): void {
    let prefix = isCocNvim ? '[coc.nvim] ' : ''
    if (msg instanceof Error) {
      if (!isTester) this.errWriteLine(prefix + msg.message + ' use :CocOpenLog for details')
      this.logError(msg.message || 'Unknown error', msg)
    } else {
      if (!isTester) this.errWriteLine(prefix + msg)
      this.logError(msg.toString(), new Error())
    }
  }

  public logError(msg: string, ...args: any[]): void {
    if (isTester) console.error(msg, ...args)
    if (!this.logger) return
    this.logger.error(msg, ...args)
  }

  public createBuffer(id: number): Buffer {
    return new Buffer({
      data: id,
      client: this
    })
  }

  public createWindow(id: number): Window {
    return new Window({
      data: id,
      client: this
    })
  }

  public createTabpage(id: number): Tabpage {
    return new Tabpage({
      data: id,
      client: this
    })
  }

  /**
   * Invoke redraw on vim.
   */
  public redrawVim(force?: boolean): void {
    if (!this.isVim) return
    this.transport.notify('nvim_command', ['redraw' + (force ? '!' : '')])
  }

  /** Attaches msgpack to read/write streams * */
  public attach({
    reader,
    writer,
  }: {
    reader: NodeJS.ReadableStream
    writer: NodeJS.WritableStream
  }, requestApi = true): void {
    this.transport.attach(writer, reader, this)
    this.transport.on('request', this.handleRequest)
    this.transport.on('notification', this.handleNotification)
    this.transport.on('detach', () => {
      this.emit('disconnect')
      this.transport.removeAllListeners('request')
      this.transport.removeAllListeners('notification')
      this.transport.removeAllListeners('detach')
    })
    if (requestApi) {
      this._isReady = this.generateApi().catch(err => {
        this.logger.error(err)
        return false
      })
    } else {
      this._channelId = -1
      this._isReady = Promise.resolve(true)
    }
  }

  /* called when attach process disconnected*/
  public detach(): void {
    this.attachedBuffers.clear()
    this.transport.detach()
    this.removeAllListeners()
  }

  public get channelId(): Promise<number> {
    return this._isReady.then(() => {
      return this._channelId
    })
  }

  private handleRequest(
    method: string,
    args: VimValue[],
    resp: any,
  ): void {
    this.emit('request', method, args, resp)
  }

  public sendAsyncRequest(method: string, args: any[]): Promise<any> {
    let id = this.requestId
    this.requestId = id + 1
    this.notify('nvim_call_function', ['coc#rpc#async_request', [id, method, args || []]])
    return new Promise<any>((resolve, reject) => {
      let response = new AsyncResponse(id, (err?: Error, res?: any): void => {
        if (err) return reject(err)
        resolve(res)
      })
      this.responses.set(id, response)
    })
  }

  private handleNotification(method: string, args: VimValue[]): void {
    if (method.endsWith('_event')) {
      if (method.startsWith('nvim_buf_')) {
        const shortName = method.replace(/nvim_buf_(.*)_event/, '$1')
        const { id } = args[0] as Buffer
        if (!this.attachedBuffers.has(id)) return
        const bufferMap = this.attachedBuffers.get(id)
        const cbs = bufferMap.get(shortName) || []
        cbs.forEach(cb => cb(...args))
        // Handle `nvim_buf_detach_event`
        // clean `attachedBuffers` since it will no longer be attached
        if (shortName === 'detach') {
          this.attachedBuffers.delete(id)
        }
        return
      }
      // async_request_event from vim
      if (method == 'nvim_async_request_event') {
        const [id, method, arr] = args
        this.handleRequest(method as string, arr as any[], {
          send: (resp: any, isError?: boolean): void => {
            this.notify('nvim_call_function', ['coc#rpc#async_response', [id, resp, isError]])
          }
        })
        return
      }
      // nvim_async_response_event
      if (method == 'nvim_async_response_event') {
        const [id, err, res] = args
        const response = this.responses.get(id as number)
        if (!response) {
          this.logError(`Response not found for request ${id}`)
          return
        }
        this.responses.delete(id as number)
        response.finish(err as string, res)
        return
      }
      if (method === 'nvim_error_event') {
        this.logger.error(`Error event from nvim:`, args[0], args[1])
        this.emit('vim_error', args[1])
        return
      }
      this.logger.warn(`Unhandled event: ${method}`, args)
    } else {
      this.emit('notification', method, args)
    }
  }

  public requestApi(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.transport.request(
        'nvim_get_api_info',
        [],
        (err: any, res: any[]) => {
          if (err) {
            reject(new Error(Array.isArray(err) ? err[1] : err.message || err.toString()))
          } else {
            resolve(res)
          }
        }
      )
    })
  }

  private async generateApi(): Promise<null | boolean> {
    let results = await this.requestApi()
    const [channelId, metadata] = results
    // TODO metadata not used
    // this.functions = metadata.functions.map(f => f.name)
    this._channelId = channelId
    return true
  }

  public attachBufferEvent(bufnr: number, eventName: string, cb: Function): void {
    const bufferMap = this.attachedBuffers.get(bufnr) || new Map<string, Function[]>()
    const cbs = bufferMap.get(eventName) || []
    if (cbs.includes(cb)) return
    cbs.push(cb)
    bufferMap.set(eventName, cbs)
    this.attachedBuffers.set(bufnr, bufferMap)
    return
  }

  /**
   * Returns `true` if buffer should be detached
   */
  public detachBufferEvent(bufnr: number, eventName: string, cb: Function): void {
    const bufferMap = this.attachedBuffers.get(bufnr)
    if (!bufferMap || !bufferMap.has(eventName)) return
    const handlers = bufferMap.get(eventName).filter(handler => handler !== cb)
    bufferMap.set(eventName, handlers)
  }

  public pauseNotification(): void {
    let o: any = {}
    Error.captureStackTrace(o)
    if (this.transport.pauseLevel != 0) {
      this.logError(`Nested nvim.pauseNotification() detected, please avoid it:`, o.stack)
    }
    this.transport.pauseNotification()
    process.nextTick(() => {
      if (this.transport.pauseLevel > 0) {
        this.logError(`resumeNotification not called within same tick:`, o.stack)
      }
    })
  }

  public resumeNotification(redrawVim?: boolean): Promise<AtomicResult>
  public resumeNotification(redrawVim: boolean, notify: true): null
  public resumeNotification(redrawVim?: boolean, notify?: boolean): Promise<AtomicResult> | null {
    if (this.isVim && redrawVim) {
      this.transport.notify('nvim_command', ['redraw'])
    }
    if (notify) {
      this.transport.resumeNotification(true)
      return Promise.resolve(null)
    }
    return this.transport.resumeNotification()
  }

  /**
   * @deprecated
   */
  public hasFunction(name: string): boolean {
    if (!this.isVim) return true
    return functionsOnVim.includes(name)
  }
}

applyMixins(NeovimClient, [EventEmitter])
