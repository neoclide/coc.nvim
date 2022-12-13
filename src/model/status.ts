'use strict'
import type { Disposable } from '../util/protocol'
import { v1 as uuidv1 } from 'uuid'
import { Neovim } from '@chemzqm/neovim'

export const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface StatusBarItem {
  /**
   * The priority of this item. Higher value means the item should
   * be shown more to the left.
   */
  readonly priority: number
  isProgress: boolean
  text: string
  show(): void
  hide(): void
  dispose(): void
}

export default class StatusLine implements Disposable {
  private items: Map<string, StatusBarItem> = new Map()
  private shownIds: Set<string> = new Set()
  private _text = ''
  private interval: NodeJS.Timer
  public nvim: Neovim
  constructor() {
    this.interval = setInterval(() => {
      this.setStatusText()
    }, 100).unref()
  }

  public dispose(): void {
    this.items.clear()
    this.shownIds.clear()
    clearInterval(this.interval)
  }

  public reset(): void {
    this.items.clear()
    this.shownIds.clear()
  }

  public createStatusBarItem(priority: number, isProgress = false): StatusBarItem {
    let uid = uuidv1()

    let item: StatusBarItem = {
      text: '',
      priority,
      isProgress,
      show: () => {
        this.shownIds.add(uid)
        this.setStatusText()
      },
      hide: () => {
        this.shownIds.delete(uid)
        this.setStatusText()
      },
      dispose: () => {
        this.shownIds.delete(uid)
        this.items.delete(uid)
        this.setStatusText()
      }
    }
    this.items.set(uid, item)
    return item
  }

  private getText(): string {
    if (this.shownIds.size == 0) return ''
    let d = new Date()
    let idx = Math.floor(d.getMilliseconds() / 100)
    let text = ''
    let items: StatusBarItem[] = []
    for (let [id, item] of this.items) {
      if (this.shownIds.has(id)) {
        items.push(item)
      }
    }
    items.sort((a, b) => a.priority - b.priority)
    for (let item of items) {
      if (!item.isProgress) {
        text = `${text} ${item.text}`
      } else {
        text = `${text} ${frames[idx]} ${item.text}`
      }
    }
    return text
  }

  private setStatusText(): void {
    let text = this.getText()
    let { nvim } = this
    if (text != this._text && nvim) {
      this._text = text
      nvim.pauseNotification()
      this.nvim.setVar('coc_status', text, true)
      this.nvim.call('coc#util#do_autocmd', ['CocStatusChange'], true)
      nvim.resumeNotification(false, true)
    }
  }
}
