import { Buffer, Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import { DialogPreferences } from '..'
import events from '../events'
import { QuickPickItem } from '../types'
import { disposeAll } from '../util'
import { byteLength } from '../util/string'
const logger = require('../util/logger')('model-dialog')
const isVim = process.env.VIM_NODE_RPC == '1'

interface PickerConfig {
  title: string
  items: QuickPickItem[]
}

/**
 * Pick multiple items from dialog
 */
export default class Picker {
  private disposables: Disposable[] = []
  private bufnr: number
  private winid: number
  private picked: Set<number> = new Set()
  private currIndex = 0
  private total: number
  private keyMappings: Map<string, (character: string) => void> = new Map()
  private readonly _onDidClose = new Emitter<number[] | undefined>()
  public readonly onDidClose: Event<number[] | undefined> = this._onDidClose.event
  constructor(private nvim: Neovim, private config: PickerConfig, token?: CancellationToken) {
    for (let i = 0; i < config.items.length; i++) {
      let item = config.items[i]
      if (item.picked) this.picked.add(i)
    }
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
        this._onDidClose.fire(undefined)
        this.bufnr = undefined
        this.winid = undefined
        this.dispose()
      }
    }, null, this.disposables)
    events.on('FloatBtnClick', (bufnr, idx) => {
      if (bufnr == this.bufnr) {
        if (idx == 0) {
          let selected = Array.from(this.picked)
          this._onDidClose.fire(selected.length ? selected : undefined)
        } else {
          this._onDidClose.fire(undefined)
        }
        this.dispose()
      }
    }, null, this.disposables)
    this.addKeymappings()
  }

  private addKeymappings(): void {
    let { nvim } = this
    const toggleSelect = idx => {
      if (this.picked.has(idx)) {
        this.picked.delete(idx)
      } else {
        this.picked.add(idx)
      }
    }
    this.addKeys('<LeftRelease>', async () => {
      // not work on vim
      if (isVim || !this.winid) return
      let [winid, lnum, col] = await nvim.eval('[v:mouse_winid,v:mouse_lnum,v:mouse_col]') as [number, number, number]
      // can't simulate vvar.
      if (global.hasOwnProperty('__TEST__')) {
        let res = await nvim.getVar('mouse_position')
        winid = res[0]
        lnum = res[1]
        col = res[2]
      }
      nvim.pauseNotification()
      if (winid == this.winid) {
        if (col <= 3) {
          toggleSelect(lnum - 1)
          this.changeLine(lnum - 1)
        } else {
          this.setCursor(lnum - 1)
        }
      }
      nvim.call('win_gotoid', [winid], true)
      nvim.call('cursor', [lnum, col], true)
      nvim.call('coc#float#nvim_float_click', [], true)
      nvim.command('redraw', true)
      await nvim.resumeNotification()
    })
    this.addKeys(['<esc>', '<C-c>'], () => {
      this._onDidClose.fire(undefined)
      this.dispose()
    })
    this.addKeys('<cr>', () => {
      if (this.picked.size == 0) {
        this._onDidClose.fire(undefined)
      } else {
        let selected = Array.from(this.picked)
        this._onDidClose.fire(selected)
      }
      this.dispose()
    })
    let setCursorIndex = idx => {
      nvim.pauseNotification()
      this.setCursor(idx)
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }
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
    this.addKeys(' ', async () => {
      let idx = this.currIndex
      toggleSelect(idx)
      nvim.pauseNotification()
      this.changeLine(idx)
      if (this.currIndex != this.total - 1) {
        this.setCursor(this.currIndex + 1)
      }
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await nvim.resumeNotification()
    })
  }

  public async show(preferences: DialogPreferences = {}): Promise<number> {
    let { nvim } = this
    let { title, items } = this.config
    let opts: any = { close: 1, cursorline: 1 }
    if (preferences.maxHeight) opts.maxHeight = preferences.maxHeight
    if (preferences.maxWidth) opts.maxWidth = preferences.maxWidth
    if (title) opts.title = title
    opts.close = 1
    opts.cursorline = 1
    if (preferences.floatHighlight) {
      opts.highlight = preferences.floatHighlight
    }
    if (preferences.floatBorderHighlight) {
      opts.borderhighlight = [preferences.floatBorderHighlight]
    }
    if (preferences.pickerButtons) {
      let shortcut = preferences.pickerButtonShortcut
      opts.buttons = ['Submit' + (shortcut ? ' <cr>' : ''), 'Cancel' + (shortcut ? ' <esc>' : '')]
    }
    let lines = []
    let positions: [number, number][] = []
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      let line = `[${item.picked ? 'x' : ' '}] ${item.label}`
      positions.push([i, byteLength(line)])
      if (item.description) line = line + ` ${item.description}`
      lines.push(line)
    }
    let res = await nvim.call('coc#float#create_dialog', [lines, opts])
    if (!res[1]) return
    this.winid = res[0]
    this.bufnr = res[1]
    let buf = nvim.createBuffer(this.bufnr)
    nvim.pauseNotification()
    for (let pos of positions) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      buf.addHighlight({ hlGroup: 'Comment', line: pos[0], srcId: 1, colStart: pos[1], colEnd: -1 })
    }
    this.highlightLine()
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    nvim.call('coc#prompt#start_prompt', ['picker'], true)
    return this.winid
  }

  public get buffer(): Buffer {
    return this.bufnr ? this.nvim.createBuffer(this.bufnr) : undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.disposables = []
    this.nvim.call('coc#prompt#stop_prompt', ['picker'], true)
    if (this.winid) {
      this.nvim.call('coc#float#close', [this.winid], true)
      this.winid = undefined
    }
  }

  private async onInputChar(session: string, character: string): Promise<void> {
    if (session != 'picker' || !this.winid) return
    let fn = this.keyMappings.get(character)
    if (fn) {
      await Promise.resolve(fn(character))
    } else {
      logger.warn(`Ignored key press: ${character}`)
    }
  }

  private changeLine(index: number): void {
    let { nvim } = this
    let item = this.config.items[index]
    if (!item) return
    let line = `[${this.picked.has(index) ? 'x' : ' '}] ${item.label}`
    let col = byteLength(line)
    if (item.description) line = line + ` ${item.description}`
    nvim.call('setbufline', [this.bufnr, index + 1, line], true)
    if (!isVim) {
      let buf = nvim.createBuffer(this.bufnr)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      buf.addHighlight({ hlGroup: 'Comment', line: index, srcId: 1, colStart: col, colEnd: -1 })
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
