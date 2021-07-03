import { Disposable } from 'vscode-languageserver-protocol'
import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { v1 as uuidv1 } from 'uuid'
const logger = require('../util/logger')('model-status')

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
  constructor(private nvim: Neovim) {
    this.interval = setInterval(() => {
      this.setStatusText().logError()
    }, 100)
  }

  public dispose(): void {
    clearInterval(this.interval)
  }

  public createStatusBarItem(priority = 0, isProgress = false): StatusBarItem {
    let uid = uuidv1()

    let item: StatusBarItem = {
      text: '',
      priority,
      isProgress,
      show: () => {
        this.shownIds.add(uid)
      },
      hide: () => {
        this.shownIds.delete(uid)
      },
      dispose: () => {
        this.shownIds.delete(uid)
        this.items.delete(uid)
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

  private async setStatusText(): Promise<void> {
    let text = this.getText()
    let { nvim } = this
    if (text != this._text) {
      this._text = text
      nvim.pauseNotification()
      this.nvim.setVar('coc_status', text, true)
      this.nvim.call('coc#util#do_autocmd', ['CocStatusChange'], true)
      await nvim.resumeNotification(false, true)
    }
  }
}
