import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { disposeAll } from '../util'
const logger = require('../util/logger')('model-dialog')

export interface DialogButton {
  /**
   * Use by callback, should >= 0
   */
  index: number
  text: string
  /**
   * Not shown when true
   */
  disabled?: boolean
}

export interface DialogPreferences {
  maxWidth?: number
  maxHeight?: number
  floatHighlight?: string
  floatBorderHighlight?: string
  pickerButtons?: boolean
  pickerButtonShortcut?: boolean
  confirmKey?: string
}

export interface DialogConfig {
  content: string
  /**
   * Optional title text.
   */
  title?: string
  /**
   * show close button, default to true when not specified.
   */
  close?: boolean
  /**
   * highlight group for dialog window, default to `"dialog.floatHighlight"` or 'CocFlating'
   */
  highlight?: string
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

export default class Dialog {
  private disposables: Disposable[] = []
  private bufnr: number
  constructor(private nvim: Neovim, private config: DialogConfig) {
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
    return [...this.config.content.split(/\r?\n/)]
  }

  public async show(preferences: DialogPreferences): Promise<void> {
    let { nvim } = this
    let { title, close, buttons } = this.config
    let borderhighlight = this.config.borderhighlight || preferences.floatBorderHighlight
    let highlight = this.config.highlight || preferences.floatHighlight
    let opts: any = { maxwidth: preferences.maxWidth || 80, }
    if (title) opts.title = title
    if (close || typeof close === 'undefined') opts.close = 1
    if (preferences.maxHeight) opts.maxHeight = preferences.maxHeight
    if (preferences.maxWidth) opts.maxWidth = preferences.maxWidth
    if (highlight) opts.highlight = highlight
    if (borderhighlight) opts.borderhighlight = [borderhighlight]
    if (buttons) opts.buttons = buttons.filter(o => !o.disabled).map(o => o.text)
    let res = await nvim.call('coc#float#create_dialog', [this.lines, opts])
    if (!res[1]) return
    this.bufnr = res[1]
    nvim.command('redraw', true)
  }

  public get winid(): Promise<number | null> {
    if (!this.bufnr) return Promise.resolve(null)
    return this.nvim.call('bufwinid', [this.bufnr])
  }

  public dispose(): void {
    this.bufnr = undefined
    disposeAll(this.disposables)
    this.disposables = []
  }
}
