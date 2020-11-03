import { Neovim } from '@chemzqm/neovim'
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
    events.on('InputChar', this.onInputChar.bind(this), null, this.disposables)
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        this._onDidClose.fire(undefined)
        this.bufnr = undefined
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
  }

  private async onInputChar(session: string, character: string): Promise<void> {
    if (session != 'picker') return
    let { nvim } = this
    if (character == '<LeftRelease>' && !isVim) {
      let [winid, lnum, col] = await nvim.eval('[v:mouse_winid,v:mouse_lnum,v:mouse_col]') as [number, number, number]
      nvim.pauseNotification()
      nvim.call('win_gotoid', [winid], true)
      nvim.call('cursor', [lnum, col], true)
      nvim.call('coc#float#nvim_float_click', [], true)
      await nvim.resumeNotification()
    }
    if (character == '<esc>') {
      this._onDidClose.fire(undefined)
      this.dispose()
    } else if (character == '<cr>') {
      if (this.picked.size == 0) {
        this._onDidClose.fire(undefined)
      } else {
        let selected = Array.from(this.picked)
        this._onDidClose.fire(selected)
      }
      this.dispose()
    } else if (character == 'j' || character == '<down>' || character == '<tab>' || character == '<C-n>') {
      // next
      let idx = this.currIndex == this.total - 1 ? 0 : this.currIndex + 1
      this.setCursor(idx)
    } else if (character == 'k' || character == '<up>' || character == '<s-tab>' || character == '<C-p>') {
      // previous
      let idx = this.currIndex == 0 ? this.total - 1 : this.currIndex - 1
      this.setCursor(idx)
    } else if (character == ' ') {
      let idx = this.currIndex
      // toggle select
      if (this.picked.has(idx)) {
        this.picked.delete(idx)
      } else {
        this.picked.add(idx)
      }
      nvim.pauseNotification()
      this.changeLine(idx)
      if (this.currIndex != this.total - 1) {
        this.setCursor(this.currIndex + 1)
      }
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await nvim.resumeNotification()
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
    let { nvim } = this
    this.currIndex = index
    nvim.pauseNotification()
    if (isVim) {
      nvim.call('win_execute', [this.winid, `exe ${this.currIndex + 1}`], true)
    } else {
      nvim.call('coc#util#win_gotoid', [this.winid], true)
      nvim.call('cursor', [this.currIndex + 1, 1], true)
      this.highlightLine()
      nvim.command('noa wincmd p', true)
    }
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  public async show(preferences: DialogPreferences): Promise<void> {
    let { nvim } = this
    let { title, items } = this.config
    let opts: any = { maxwidth: preferences.maxWidth || 80, }
    if (preferences.maxHeight) opts.maxheight = preferences.maxHeight
    if (preferences.maxWidth) opts.maxwidth = preferences.maxWidth
    if (title) opts.title = title
    opts.close = 1
    opts.cursorline = 1
    opts.highlight = 'Normal'
    opts.borderhighlight = ['MoreMsg']
    opts.buttons = ['Submit', 'Cancel']
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
    if (!isVim) {
      for (let pos of positions) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        buf.addHighlight({ hlGroup: 'Comment', line: pos[0], srcId: 1, colStart: pos[1], colEnd: -1 })
      }
      this.highlightLine()
    }
    nvim.command('redraw', true)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    nvim.call('coc#prompt#start_prompt', ['picker'], true)
  }

  private highlightLine(): void {
    let { nvim, currIndex } = this
    if (isVim || !this.bufnr) return
    nvim.command(`sign unplace 6 buffer=${this.bufnr}`, true)
    nvim.command(`sign place 6 line=${currIndex + 1} name=CocCurrentLine buffer=${this.bufnr}`, true)
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this._onDidClose.dispose()
    this.disposables = []
    this.nvim.call('coc#prompt#stop_prompt', ['picker'], true)
    if (this.winid) {
      this.nvim.call('coc#float#close', [this.winid], true)
    }
  }
}
