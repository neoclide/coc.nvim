import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { DialogPreferences } from '..'
import events from '../events'
import { DialogConfig } from '../types'
import { disposeAll } from '../util'
const logger = require('../util/logger')('model-dialog')

export default class Dialog {
  private disposables: Disposable[] = []
  private bufnr: number
  constructor(private nvim: Neovim, private config: DialogConfig) {
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        this.dispose()
        config.callback(-1)
      }
    }, null, this.disposables)
    events.on('FloatBtnClick', (bufnr, idx) => {
      if (bufnr == this.bufnr) {
        this.dispose()
        let btns = config?.buttons.filter(o => o.disabled != true)
        config.callback(btns[idx].index)
      }
    }, null, this.disposables)
  }

  public async show(preferences: DialogPreferences): Promise<void> {
    let { nvim } = this
    let { title, content, close, buttons } = this.config
    title = title || ''
    buttons = buttons || []
    let btns = buttons.filter(o => !o.disabled).map(o => o.text)
    let config = await nvim.call('coc#float#get_config_dialog', [title, content.split(/\r?\n/), btns, {
      maxheight: preferences.maxHeight || 80,
      maxwidth: preferences.maxWidth || 80
    }])
    if (!config) return
    let obj = Object.assign({}, config, {
      buttons: btns,
      close: close == null ? 1 : close
    })
    let res = await nvim.call('coc#float#create_float_win', [0, 0, obj])
    this.bufnr = res[1]
    let buf = nvim.createBuffer(this.bufnr)
    nvim.pauseNotification()
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    buf.setLines(content.split(/\r?\n/), { start: 0, end: -1, strictIndexing: false }, true)
    nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  public dispose(): void {
    this.bufnr = undefined
    disposeAll(this.disposables)
    this.disposables = []
  }
}
