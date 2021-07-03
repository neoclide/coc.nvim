import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { disposeAll } from '../util'
import { DialogButton } from './dialog'
const isVim = process.env.VIM_NODE_RPC == '1'
const logger = require('../util/logger')('model-notification')

export interface NotificationPreferences {
  top: number
  right: number
  maxWidth: number
  maxHeight: number
  highlight: string
  minProgressWidth: number
}

export interface NotificationConfig {
  content: string
  /**
   * Optional title text.
   */
  title?: string
  /**
   * Timeout in miliseconds to dismiss notification.
   */
  timeout?: number
  /**
   * show close button, default to true when not specified.
   */
  close?: boolean
  /**
   * highlight groups for border, default to `"dialog.borderhighlight"` or 'CocFlating'
   */
  borderhighlight?: string
  /**
   * Buttons as bottom of dialog.
   */
  buttons?: DialogButton[]
  /**
   * index is -1 for window close without button click
   */
  callback?: (index: number) => void
}

export default class Notification {
  protected disposables: Disposable[] = []
  protected bufnr: number
  protected _winid: number
  protected _disposed = false
  constructor(protected nvim: Neovim, protected config: NotificationConfig, attachEvents = true) {
    if (attachEvents) {
      events.on('BufWinLeave', bufnr => {
        if (bufnr == this.bufnr) {
          this.dispose()
          if (config.callback) config.callback(-1)
        }
      }, null, this.disposables)
      events.on('FloatBtnClick', (bufnr, idx) => {
        if (bufnr == this.bufnr) {
          this.dispose()
          let btns = config?.buttons.filter(o => o.disabled != true)
          if (config.callback) config.callback(btns[idx].index)
        }
      }, null, this.disposables)
    }
  }

  protected get lines(): string[] {
    return this.config.content.split(/\r?\n/)
  }

  public async show(preferences: Partial<NotificationPreferences>): Promise<any> {
    let { nvim } = this
    let { title, close, timeout, buttons, borderhighlight } = this.config
    let opts: any = Object.assign({}, preferences)
    opts.close = close ? 1 : 0
    if (title) opts.title = title
    if (borderhighlight) opts.borderhighlight = borderhighlight
    if (buttons) opts.buttons = buttons.filter(o => !o.disabled).map(o => o.text)
    if (timeout) opts.timeout = timeout
    let res = await nvim.call('coc#float#create_notification', [this.lines, opts]) as [number, number]
    if (!res) return false
    if (this._disposed) {
      this.nvim.call('coc#float#close', [res[0]], true)
      if (isVim) this.nvim.command('redraw', true)
    } else {
      this._winid = res[0]
      this.bufnr = res[1]
    }
    return this._winid != undefined
  }

  public get winid(): number | undefined {
    return this._winid
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    let { winid } = this
    if (winid) {
      this.nvim.call('coc#float#close', [winid], true)
      if (isVim) this.nvim.command('redraw', true)
    }
    this.bufnr = undefined
    this._winid = undefined
    disposeAll(this.disposables)
    this.disposables = []
  }
}
