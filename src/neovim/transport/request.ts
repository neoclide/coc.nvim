import { NeovimClient } from '../api'
import { isCocNvim } from '../utils/constants'
import Connection from './connection'
const func = isCocNvim ? 'coc#api#Call' : 'nvim#api#Call'

export default class Request {
  private method: string
  private _direct = false
  constructor(
    private connection: Connection,
    private cb: (...args: any[]) => any,
    private readonly id: number
  ) {
  }

  public get isDirect(): boolean {
    return this._direct
  }

  public request(method: string, args: any[] = []): void {
    this.method = method
    this.connection.call(func, [method.slice(5), args], this.id)
  }

  public call(method: string, args: any[] = []): void {
    this._direct = true
    this.method = 'call'
    this.connection.call(method, args, this.id)
  }

  public expr(expr: string): void {
    this._direct = true
    this.method = 'expr'
    this.connection.expr(expr, this.id)
  }

  public callback(client: NeovimClient, err: any, result: any): void {
    let { method, cb } = this
    // error type and error string
    if (err) return cb([0, err.toString()])
    switch (method) {
      case 'nvim_list_wins':
      case 'nvim_tabpage_list_wins':
        return cb(null, result.map(o => client.createWindow(o)))
      case 'nvim_tabpage_get_win':
      case 'nvim_get_current_win':
      case 'nvim_open_win':
        return cb(null, client.createWindow(result))
      case 'nvim_list_bufs':
        return cb(null, result.map(o => client.createBuffer(o)))
      case 'nvim_win_get_buf':
      case 'nvim_create_buf':
      case 'nvim_get_current_buf':
        return cb(null, client.createBuffer(result))
      case 'nvim_list_tabpages':
        return cb(null, result.map(o => client.createTabpage(o)))
      case 'nvim_win_get_tabpage':
      case 'nvim_get_current_tabpage':
        return cb(null, client.createTabpage(result))
      default:
        return cb(null, result)
    }
  }
}
