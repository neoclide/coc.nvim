import Transport from '../transport/base'
import { VimValue } from '../types'
import { NeovimClient } from './client'

export interface BaseConstructorOptions {
  data?: number
  client?: any
}

export class BaseApi {
  protected prefix: string
  public data: number | undefined
  protected client: NeovimClient

  constructor({
    data,
    client,
  }: BaseConstructorOptions) {
    this.data = data
    if (client) {
      this.client = client
    } else {
      Object.defineProperty(this, 'client', {
        value: this
      })
    }
  }

  protected get transport(): Transport {
    return this.client._transport
  }

  public equals(other: BaseApi): boolean {
    try {
      return String(this.data) === String(other.data)
    } catch (e) {
      return false
    }
  }

  public async request(name: string, args: any[] = []): Promise<any> {
    Error.captureStackTrace(args)
    return new Promise<any>((resolve, reject) => {
      this.transport.request(name, this.getArgsByPrefix(args), (err: any, res: any) => {
        if (err) {
          let e = new Error(err[1])
          if (!name.endsWith('get_var')) {
            let stack = (args as any).stack
            e.stack = `Error: request error on "${name}" - ${err[1]}\n` + stack.split(/\r?\n/).slice(3).join('\n')
            this.client.logError(`request error on "${name}"`, args, e)
          }
          reject(e)
        } else {
          resolve(res)
        }
      })
    })
  }

  protected getArgsByPrefix(args: any[]): any[] {
    // Check if class is Neovim and if so, should not send `this` as first arg
    if (this.prefix !== 'nvim_' && args[0] != this) {
      let id = this.transport.isVim ? this.data : this
      return [id, ...args]
    }
    return args
  }

  /** Retrieves a scoped variable depending on type (using `this.prefix`) */
  public getVar(name: string): Promise<VimValue> {
    return this.request(`${this.prefix}get_var`, [name]).then(
      res => res,
      _err => {
        return null
      }
    )
  }

  /** Set a scoped variable */
  public setVar(name: string, value: VimValue, isNotify: true): void
  public setVar(name: string, value: VimValue, isNotify?: false): Promise<void>
  public setVar(name: string, value: VimValue, isNotify = false): Promise<void> | void {
    if (isNotify) {
      this.notify(`${this.prefix}set_var`, [name, value])
      return
    }
    return this.request(`${this.prefix}set_var`, [name, value])
  }

  /** Delete a scoped variable */
  public deleteVar(name: string): void {
    this.notify(`${this.prefix}del_var`, [name])
  }

  /** Retrieves a scoped option depending on type of `this` */
  public getOption(name: string): Promise<VimValue> {
    return this.request(`${this.prefix}get_option`, [name])
  }

  /** Set scoped option */
  public setOption(name: string, value: VimValue): Promise<void>
  public setOption(name: string, value: VimValue, isNotify: true): void
  public setOption(name: string, value: VimValue, isNotify?: boolean): Promise<void> | void {
    if (isNotify) {
      this.notify(`${this.prefix}set_option`, [name, value])
      return
    }
    return this.request(`${this.prefix}set_option`, [name, value])
  }

  /** `request` is basically the same except you can choose to wait forpromise to be resolved */
  public notify(name: string, args: any[] = []): void {
    this.transport.notify(name, this.getArgsByPrefix(args))
  }

  public toJSON(): number {
    return this.data ?? 0
  }
}
