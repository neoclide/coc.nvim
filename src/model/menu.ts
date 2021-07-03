import { Buffer, Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { disposeAll } from '../util'
import { DialogPreferences } from './dialog'
import Popup from './popup'
const logger = require('../util/logger')('model-menu')

export interface MenuConfig {
  items: string[]
  title?: string
}

/**
 * Select single item from menu at cursor position.
 */
export default class Menu {
  private bufnr: number
  private win: Popup
  private currIndex = 0
  private total: number
  private disposables: Disposable[] = []
  private keyMappings: Map<string, (character: string) => void> = new Map()
  private readonly _onDidClose = new Emitter<number>()
  public readonly onDidClose: Event<number> = this._onDidClose.event
  constructor(private nvim: Neovim, private config: MenuConfig, token?: CancellationToken) {
    this.total = config.items.length
    if (token) {
      token.onCancellationRequested(() => {
        this.win?.close()
      })
    }
    this.disposables.push(this._onDidClose)
    this.addKeymappings()
  }

  private attachEvents(): void {
    events.on('InputChar', this.onInputChar.bind(this), null, this.disposables)
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        this._onDidClose.fire(-1)
        this.bufnr = undefined
        this.win = undefined
        this.dispose()
      }
    }, null, this.disposables)
  }

  private addKeymappings(): void {
    let { nvim } = this
    this.addKeys(['<esc>', '<C-c>'], () => {
      this._onDidClose.fire(-1)
      this.dispose()
    })
    this.addKeys(['\r', '<cr>'], () => {
      this._onDidClose.fire(this.currIndex)
      this.dispose()
    })
    let setCursorIndex = idx => {
      if (!this.win) return
      nvim.pauseNotification()
      this.setCursor(idx)
      this.win?.refreshScrollbar()
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }
    this.addKeys('<C-f>', async () => {
      await this.win?.scrollForward()
    })
    this.addKeys('<C-b>', async () => {
      await this.win?.scrollBackward()
    })
    this.addKeys(['j', '<down>', '<tab>', '<C-n>'], () => {
      // next
      let idx = this.currIndex == this.total - 1 ? 0 : this.currIndex + 1
      setCursorIndex(idx)
    })
    this.addKeys(['k', '<up>', '<s-tab>', '<C-p>'], () => {
      // previous
      let idx = this.currIndex == 0 ? this.total - 1 : this.currIndex - 1
      setCursorIndex(idx)
    })
    this.addKeys(['g'], () => {
      setCursorIndex(0)
    })
    this.addKeys(['G'], () => {
      setCursorIndex(this.total - 1)
    })
    let timer: NodeJS.Timeout
    let firstNumber: number
    this.addKeys(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], character => {
      if (timer) clearTimeout(timer)
      let n = parseInt(character, 10)
      if (isNaN(n) || n > this.total) return
      if (firstNumber == null && n == 0) return
      if (firstNumber) {
        let count = firstNumber * 10 + n
        firstNumber = undefined
        this._onDidClose.fire(count - 1)
        this.dispose()
        return
      }
      if (this.total < 10 || n * 10 > this.total) {
        this._onDidClose.fire(n - 1)
        this.dispose()
        return
      }
      timer = setTimeout(async () => {
        this._onDidClose.fire(n - 1)
        this.dispose()
      }, 200)
      firstNumber = n
    })
  }

  public async show(preferences: DialogPreferences = {}): Promise<number> {
    let { nvim } = this
    let { title, items } = this.config
    let opts: any = {}
    if (title) opts.title = title
    if (preferences.maxHeight) opts.maxHeight = preferences.maxHeight
    if (preferences.maxWidth) opts.maxWidth = preferences.maxWidth
    if (preferences.floatHighlight) opts.highlight = preferences.floatHighlight
    if (preferences.floatBorderHighlight) opts.borderhighlight = [preferences.floatBorderHighlight]
    let lines = items.map((v, i) => {
      if (i < 99) return `${i + 1}. ${v}`
      return v
    })
    if (preferences.confirmKey && preferences.confirmKey != '<cr>') {
      this.addKeys(preferences.confirmKey, () => {
        this._onDidClose.fire(this.currIndex)
        this.dispose()
      })
    }
    let res = await nvim.call('coc#float#create_menu', [lines, opts]) as [number, number]
    this.win = new Popup(nvim, res[0], res[1])
    this.bufnr = res[1]
    this.attachEvents()
    nvim.call('coc#prompt#start_prompt', ['menu'], true)
    return res[0]
  }

  public get buffer(): Buffer {
    return this.bufnr ? this.nvim.createBuffer(this.bufnr) : undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.disposables = []
    this.nvim.call('coc#prompt#stop_prompt', ['menu'], true)
    this.win?.close()
    this.win = undefined
  }

  private async onInputChar(session: string, character: string): Promise<void> {
    if (session != 'menu' || !this.win) return
    let fn = this.keyMappings.get(character)
    if (fn) {
      await Promise.resolve(fn(character))
    } else {
      logger.warn(`Ignored key press: ${character}`)
    }
  }

  private setCursor(index: number): void {
    if (!this.win) return
    this.currIndex = index
    this.win.setCursor(index)
  }

  private addKeys(keys: string | string[], fn: (character: string) => void): void {
    if (Array.isArray(keys)) {
      for (let key of keys) {
        this.keyMappings.set(key, fn)
      }
    } else {
      this.keyMappings.set(keys, fn)
    }
  }
}
