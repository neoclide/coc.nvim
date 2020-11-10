import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { NotificationConfig, NotificationPreferences } from '../types'
import { disposeAll } from '../util'
const logger = require('../util/logger')('model-notification')

export default class Notification {
  private disposables: Disposable[] = []
  private bufnr: number
  private _winid: number
  constructor(private nvim: Neovim, private config: NotificationConfig) {
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

  private get lines(): string[] {
    return this.config.content.trim().split(/\r?\n/)
  }

  public async show(preferences: Partial<NotificationPreferences>): Promise<boolean> {
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
    this._winid = res[0]
    this.bufnr = res[1]
    return true
  }

  public get winid(): number | undefined {
    return this._winid
  }

  public dispose(): void {
    this.bufnr = undefined
    this._winid = undefined
    disposeAll(this.disposables)
    this.disposables = []
  }
}
