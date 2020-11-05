import { Buffer, Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { DialogPreferences } from '..'
import events from '../events'
import { disposeAll } from '../util'
const logger = require('../util/logger')('model-menu')
const isVim = process.env.VIM_NODE_RPC == '1'

export interface MenuConfig {
  items: string[]
  title?: string
}

/**
 * Select single item from menu at cursor position.
 */
export default class Menu {
  private bufnr: number
  private winid: number
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
        if (this.winid) {
          nvim.call('coc#float#close', [this.winid], true)
        }
      })
    }
    this.disposables.push(this._onDidClose)
    events.on('InputChar', this.onInputChar.bind(this), null, this.disposables)
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        this._onDidClose.fire(-1)
        this.bufnr = undefined
        this.winid = undefined
        this.dispose()
      }
    }, null, this.disposables)
    this.addKeymappings()
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
      nvim.pauseNotification()
      this.setCursor(idx)
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }
    this.addKeys('<C-f>', async () => {
      if (!isVim) {
        let infos = await nvim.call('getwininfo', [this.winid])
        let botline = infos[0].botline
        if (botline >= this.total) return
        nvim.pauseNotification()
        nvim.call('win_gotoid', this.winid, true)
        this.setCursor(botline - 1)
        nvim.command(`normal! ${botline}Gzt`, true)
        nvim.call('coc#float#nvim_scrollbar', [this.winid], true)
        nvim.command('redraw', true)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        nvim.resumeNotification(false, true)
      }
      // TODO support vim8
      // nvim.call('coc#float#scroll', [1], true)
    })
    this.addKeys('<C-b>', async () => {
      if (!isVim) {
        let infos = await nvim.call('getwininfo', [this.winid])
        let topline = infos[0].topline
        if (topline == 1) return
        nvim.pauseNotification()
        nvim.call('win_gotoid', this.winid, true)
        this.setCursor(topline - 1)
        nvim.command(`normal! ${topline}Gzb`, true)
        nvim.call('coc#float#nvim_scrollbar', [this.winid], true)
        nvim.command('redraw', true)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        nvim.resumeNotification(false, true)
      }
      // TODO support vim8
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
    let res = await nvim.call('coc#float#create_menu', [lines, opts])
    if (!res[1]) return
    this.winid = res[0]
    this.bufnr = res[1]
    nvim.command('redraw', true)
    nvim.call('coc#prompt#start_prompt', ['menu'], true)
    return this.winid
  }

  public get buffer(): Buffer {
    return this.bufnr ? this.nvim.createBuffer(this.bufnr) : undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.disposables = []
    this.nvim.call('coc#prompt#stop_prompt', ['menu'], true)
    if (this.winid) {
      this.nvim.call('coc#float#close', [this.winid], true)
      this.winid = undefined
    }
  }

  private async onInputChar(session: string, character: string): Promise<void> {
    if (session != 'menu' || !this.winid) return
    let fn = this.keyMappings.get(character)
    if (fn) {
      await Promise.resolve(fn(character))
    } else {
      logger.warn(`Ignored key press: ${character}`)
    }
  }

  private setCursor(index: number): void {
    let { nvim, winid } = this
    if (!winid) return
    this.currIndex = index
    if (isVim) {
      nvim.call('win_execute', [winid, `exe ${this.currIndex + 1}`], true)
    } else {
      let win = nvim.createWindow(winid)
      win.notify('nvim_win_set_cursor', [[index + 1, 0]])
      this.highlightLine()
    }
  }

  private highlightLine(): void {
    let { nvim, currIndex } = this
    // user cursorline on vim8
    if (isVim || !this.bufnr) return
    nvim.command(`sign unplace 6 buffer=${this.bufnr}`, true)
    nvim.command(`sign place 6 line=${currIndex + 1} name=CocCurrentLine buffer=${this.bufnr}`, true)
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
