'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Disposable } from '../util/protocol'
import events from '../events'
import { disposeAll } from '../util'
import { DialogButton } from './dialog'
import { toArray } from '../util/array'

/**
 * Represents an action that is shown with an information, warning, or
 * error message.
 *
 * @see [showInformationMessage](#window.showInformationMessage)
 * @see [showWarningMessage](#window.showWarningMessage)
 * @see [showErrorMessage](#window.showErrorMessage)
 */
export interface MessageItem {

  /**
   * A short title like 'Retry', 'Open Log' etc.
   */
  title: string

  /**
   * A hint for modal dialogs that the item should be triggered
   * when the user cancels the dialog (e.g. by pressing the ESC
   * key).
   *
   * Note: this option is ignored for non-modal messages.
   * Note: not used by coc.nvim for now.
   */
  isCloseAffordance?: boolean
}

export interface NotificationPreferences {
  disabled: boolean
  maxWidth: number
  maxHeight: number
  highlight: string
  winblend: number
  border: boolean
  timeout: number
  marginRight: number
  focusable: boolean
  minWidth?: number
  source?: string
}

export type NotificationKind = 'error' | 'info' | 'warning' | 'progress'

export interface NotificationConfig {
  kind?: NotificationKind

  content?: string
  /**
   * Optional title text.
   */
  title?: string
  /**
   * Buttons as bottom of dialog.
   */
  buttons?: DialogButton[]
  /**
   * index is -1 for window close without button click
   */
  callback?: (index: number) => void
  closable?: boolean
}

export function toButtons(texts: string[]): DialogButton[] {
  return texts.map((s, index) => {
    return { text: s, index }
  })
}

export function toTitles(items: (string | MessageItem)[]): string[] {
  return items.map(item => typeof item === 'string' ? item : item.title)
}

export default class Notification {
  protected disposables: Disposable[] = []
  public bufnr: number
  protected _winid: number
  constructor(protected nvim: Neovim, protected config: NotificationConfig, attachEvents = true) {
    if (attachEvents) {
      events.on('BufWinLeave', bufnr => {
        if (bufnr == this.bufnr) {
          this.dispose()
          if (config.callback) config.callback(-1)
        }
      }, null, this.disposables)
      let btns = toArray(config.buttons).filter(o => o.disabled != true)
      events.on('FloatBtnClick', (bufnr, idx) => {
        if (bufnr == this.bufnr) {
          this.dispose()
          if (config.callback) config.callback(btns[idx].index)
        }
      }, null, this.disposables)
    }
  }

  protected get lines(): string[] {
    return this.config.content ? this.config.content.split(/\r?\n/) : []
  }

  public async show(preferences: Partial<NotificationPreferences>): Promise<void> {
    let { nvim } = this
    let { buttons, kind, title } = this.config
    let opts: any = Object.assign({}, preferences)
    opts.kind = kind ?? ''
    opts.close = this.config.closable === true ? 1 : 0
    if (title) opts.title = title
    if (preferences.border) {
      opts.borderhighlight = kind ? `CocNotification${kind[0].toUpperCase()}${kind.slice(1)}` : preferences.highlight
    }
    if (Array.isArray(buttons)) {
      let actions: string[] = buttons.filter(o => !o.disabled).map(o => o.text)
      if (actions.length) opts.actions = actions
    }
    let res = await nvim.call('coc#notify#create', [this.lines, opts]) as [number, number]
    this._winid = res[0]
    this.bufnr = res[1]
  }

  public get winid(): number | undefined {
    return this._winid
  }

  public dispose(): void {
    let { winid } = this
    if (winid) {
      this.nvim.call('coc#notify#close', [winid], true)
      this.nvim.redrawVim()
    }
    this.bufnr = undefined
    this._winid = undefined
    disposeAll(this.disposables)
  }
}
