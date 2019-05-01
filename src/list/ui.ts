import { Neovim, Window } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { ListHighlights, ListItem } from '../types'
import { disposeAll } from '../util'
import workspace from '../workspace'
import ListConfiguration from './configuration'
import debounce = require('debounce')
const logger = require('../util/logger')('list-ui')

export type MouseEvent = 'mouseDown' | 'mouseDrag' | 'mouseUp' | 'doubleClick'

export interface MousePosition {
  winid: number
  lnum: number
  col: number
  current: boolean
}

export default class ListUI {
  public window: Window
  private height: number
  private _bufnr = 0
  private currIndex = 0
  private highlights: ListHighlights[] = []
  private items: ListItem[] = []
  private disposables: Disposable[] = []
  private signOffset: number
  private selected: Set<number> = new Set()
  private mouseDown: MousePosition
  private creating = false
  private _onDidChangeLine = new Emitter<number>()
  private _onDidChangeHeight = new Emitter<void>()
  private _onDidOpen = new Emitter<number>()
  private _onDidClose = new Emitter<number>()
  private _onDidChange = new Emitter<void>()
  private _onDidLineChange = new Emitter<number>()
  private _onDoubleClick = new Emitter<void>()
  private hlGroupMap: Map<string, string> = new Map()
  public readonly onDidChangeLine: Event<number> = this._onDidChangeLine.event
  public readonly onDidChangeHeight: Event<void> = this._onDidChangeHeight.event
  public readonly onDidLineChange: Event<number> = this._onDidLineChange.event
  public readonly onDidOpen: Event<number> = this._onDidOpen.event
  public readonly onDidClose: Event<number> = this._onDidClose.event
  public readonly onDidChange: Event<void> = this._onDidChange.event
  public readonly onDidDoubleClick: Event<void> = this._onDoubleClick.event

  constructor(private nvim: Neovim, private config: ListConfiguration) {
    let signText = config.get<string>('selectedSignText', '*')
    nvim.command(`sign define CocSelected text=${signText} texthl=CocSelectedText linehl=CocSelectedLine`, true)
    this.signOffset = config.get<number>('signOffset')

    events.on('BufUnload', async bufnr => {
      if (bufnr == this.bufnr) {
        this._bufnr = 0
        this.window = null
        this._onDidClose.fire(bufnr)
      }
    }, null, this.disposables)

    let timer: NodeJS.Timeout
    events.on('CursorMoved', async (bufnr, cursor) => {
      if (timer) clearTimeout(timer)
      if (bufnr != this.bufnr) return
      let lnum = cursor[0]
      if (this.currIndex + 1 != lnum) {
        this.currIndex = lnum - 1
        this._onDidChangeLine.fire(lnum)
      }
    }, null, this.disposables)

    events.on('CursorMoved', debounce(async bufnr => {
      if (bufnr != this.bufnr) return
      // if (this.length < 500) return
      let [start, end] = await nvim.eval('[line("w0"),line("w$")]') as number[]
      // if (end < 500) return
      nvim.pauseNotification()
      this.doHighlight(start - 1, end - 1)
      nvim.command('redraw', true)
      await nvim.resumeNotification(false, true)
    }, 50))
  }

  public set index(n: number) {
    if (n < 0 || n >= this.items.length) return
    this.currIndex = n
    if (this.window) {
      let { nvim } = this
      nvim.pauseNotification()
      this.setCursor(n + 1, 0)
      nvim.command('redraw', true)
      nvim.resumeNotification(false, true).catch(_e => {
        // noop
      })
    }
  }

  public get index(): number {
    return this.currIndex
  }

  public getItem(delta: number): ListItem {
    let { currIndex } = this
    return this.items[currIndex + delta]
  }

  public get item(): Promise<ListItem> {
    let { window } = this
    if (!window) return Promise.resolve(null)
    return window.cursor.then(cursor => {
      this.currIndex = cursor[0] - 1
      return this.items[this.currIndex]
    }, _e => {
      return null
    })
  }

  public async echoMessage(item: ListItem): Promise<void> {
    if (this.bufnr) return
    let { items } = this
    let idx = items.indexOf(item)
    let msg = `[${idx + 1}/${items.length}] ${item.label || ''}`
    this.nvim.callTimer('coc#util#echo_lines', [[msg]], true)
  }

  public async updateItem(item: ListItem, index: number): Promise<void> {
    if (!this.bufnr || workspace.bufnr != this.bufnr) return
    let obj: ListItem = Object.assign({ resolved: true }, item)
    if (index < this.length) {
      this.items[index] = obj
      let { nvim } = this
      nvim.pauseNotification()
      nvim.command('setl modifiable', true)
      nvim.call('setline', [index + 1, obj.label], true)
      nvim.command('setl nomodifiable', true)
      await nvim.resumeNotification()
    }
  }

  public async getItems(): Promise<ListItem[]> {
    if (this.length == 0) return []
    let mode = await this.nvim.call('mode')
    if (mode == 'v' || mode == 'V') {
      let [start, end] = await this.getSelectedRange()
      let res: ListItem[] = []
      for (let i = start; i <= end; i++) {
        res.push(this.items[i - 1])
      }
      return res
    }
    let { selectedItems } = this
    if (selectedItems.length) return selectedItems
    let item = await this.item
    return item == null ? [] : [item]
  }

  public async onMouse(event: MouseEvent): Promise<void> {
    let { nvim, window } = this
    let winid = await nvim.getVvar('mouse_winid') as number
    if (!window) return
    let lnum = await nvim.getVvar('mouse_lnum') as number
    let col = await nvim.getVvar('mouse_col') as number
    if (event == 'mouseDown') {
      this.mouseDown = { winid, lnum, col, current: winid == window.id }
      return
    }
    let current = winid == window.id
    if (current && event == 'doubleClick') {
      this.setCursor(lnum, 0)
      this._onDoubleClick.fire()
    }
    if (!this.mouseDown || this.mouseDown.winid != this.mouseDown.winid) return
    if (current && event == 'mouseDrag') {
      await this.selectLines(this.mouseDown.lnum, lnum)
    } else if (current && event == 'mouseUp') {
      if (this.mouseDown.lnum == lnum) {
        nvim.pauseNotification()
        this.clearSelection()
        this.setCursor(lnum, 0)
        nvim.command('redraw', true)
        await nvim.resumeNotification()
      } else {
        await this.selectLines(this.mouseDown.lnum, lnum)
      }
    } else if (!current && event == 'mouseUp') {
      nvim.pauseNotification()
      nvim.call('win_gotoid', winid, true)
      nvim.call('cursor', [lnum, col], true)
      await nvim.resumeNotification()
    }
  }

  public reset(): void {
    this.items = []
    this.mouseDown = null
    this.selected = new Set()
    this._bufnr = 0
    this.window = null
  }

  public hide(): void {
    let { bufnr, nvim } = this
    if (bufnr) {
      this._bufnr = 0
      nvim.command(`silent! bd! ${bufnr}`, true)
    }
  }

  public async resume(name: string, position: string): Promise<void> {
    let { items, selected, nvim, signOffset } = this
    await this.drawItems(items, name, position, true)
    if (selected.size > 0 && this.bufnr) {
      nvim.pauseNotification()
      for (let lnum of selected) {
        nvim.command(`sign place ${signOffset + lnum} line=${lnum} name=CocSelected buffer=${this.bufnr}`, true)
      }
      await nvim.resumeNotification()
    }
  }

  public async toggleSelection(): Promise<void> {
    let { nvim, selected, signOffset, bufnr } = this
    if (workspace.bufnr != bufnr) return
    let lnum = await nvim.call('line', '.')
    let mode = await nvim.call('mode')
    if (mode == 'v' || mode == 'V') {
      let [start, end] = await this.getSelectedRange()
      let exists = selected.has(start)
      let reverse = start > end
      if (reverse) [start, end] = [end, start]
      for (let i = start; i <= end; i++) {
        if (!exists) {
          selected.add(i)
          nvim.command(`sign place ${signOffset + i} line=${i} name=CocSelected buffer=${bufnr}`, true)
        } else {
          selected.delete(i)
          nvim.command(`sign unplace ${signOffset + i} buffer=${bufnr}`, true)
        }
      }
      this.setCursor(end, 0)
      nvim.command('redraw', true)
      await nvim.resumeNotification()
      return
    }
    let exists = selected.has(lnum)
    nvim.pauseNotification()
    if (exists) {
      selected.delete(lnum)
      nvim.command(`sign unplace ${signOffset + lnum} buffer=${bufnr}`, true)
    } else {
      selected.add(lnum)
      nvim.command(`sign place ${signOffset + lnum} line=${lnum} name=CocSelected buffer=${bufnr}`, true)
    }
    this.setCursor(lnum + 1, 0)
    nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  public async selectLines(start: number, end: number): Promise<void> {
    let { nvim, signOffset, bufnr, length } = this
    this.clearSelection()
    let { selected } = this
    nvim.pauseNotification()
    let reverse = start > end
    if (reverse) [start, end] = [end, start]
    for (let i = start; i <= end; i++) {
      if (i > length) break
      selected.add(i)
      nvim.command(`sign place ${signOffset + i} line=${i} name=CocSelected buffer=${bufnr}`, true)
    }
    this.setCursor(end, 0)
    nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  public async selectAll(): Promise<void> {
    let { length } = this
    if (length == 0) return
    await this.selectLines(1, length)
  }

  public clearSelection(): void {
    let { selected, nvim, signOffset, bufnr } = this
    if (!bufnr) return
    if (selected.size > 0) {
      let signIds: number[] = []
      for (let lnum of selected) {
        signIds.push(signOffset + lnum)
      }
      nvim.call('coc#util#unplace_signs', [bufnr, signIds], true)
      this.selected = new Set()
    }
  }

  public get shown(): boolean {
    return this._bufnr != 0
  }

  public get bufnr(): number {
    return this._bufnr
  }

  public get ready(): Promise<void> {
    if (this._bufnr) return Promise.resolve()
    if (this.creating) {
      return new Promise<void>(resolve => {
        let disposable = this.onDidOpen(() => {
          disposable.dispose()
          resolve()
        })
      })
    }
  }

  public async drawItems(items: ListItem[], name: string, position = 'bottom', reload = false): Promise<void> {
    let { bufnr, config, nvim } = this
    let maxHeight = config.get<number>('maxHeight', 12)
    let height = Math.max(1, Math.min(items.length, maxHeight))
    let limitLines = config.get<number>('limitLines', 1000)
    let curr = this.items[this.index]
    this.items = items.slice(0, limitLines)
    if (this.hlGroupMap.size == 0) {
      let map = await nvim.call('coc#list#get_colors')
      for (let key of Object.keys(map)) {
        let foreground = key[0].toUpperCase() + key.slice(1)
        let foregroundColor = map[key]
        for (let key of Object.keys(map)) {
          let background = key[0].toUpperCase() + key.slice(1)
          let backgroundColor = map[key]
          let group = `CocList${foreground}${background}`
          this.hlGroupMap.set(group, `hi default CocList${foreground}${background} guifg=${foregroundColor} guibg=${backgroundColor}`)
        }
        this.hlGroupMap.set(`CocListFg${foreground}`, `hi default CocListFg${foreground} guifg=${foregroundColor}`)
        this.hlGroupMap.set(`CocListBg${foreground}`, `hi default CocListBg${foreground} guibg=${foregroundColor}`)
      }
    }
    if (bufnr == 0 && !this.creating) {
      this.creating = true
      let saved = await nvim.call('winsaveview')
      let cmd = 'keepalt ' + (position == 'top' ? '' : 'botright') + ` ${height}sp list:///${name || 'anonymous'}`
      nvim.pauseNotification()
      nvim.command(cmd, true)
      nvim.command(`resize ${height}`, true)
      nvim.command('wincmd p', true)
      nvim.call('winrestview', [saved], true)
      nvim.command('wincmd p', true)
      await nvim.resumeNotification()
      this._bufnr = await nvim.call('bufnr', '%')
      this.window = await nvim.window
      this.height = height
      this._onDidOpen.fire(this.bufnr)
      this.creating = false
    } else {
      await this.ready
    }
    let lines = this.items.map(item => item.label)
    this.clearSelection()
    await this.setLines(lines, false, reload ? this.currIndex : 0)
    let item = this.items[this.index] || { label: '' }
    if (!curr || curr.label != item.label) {
      this._onDidLineChange.fire(this.index + 1)
    }
  }

  public async appendItems(items: ListItem[]): Promise<void> {
    let { config } = this
    let limitLines = config.get<number>('limitLines', 1000)
    let curr = this.items.length
    if (curr >= limitLines) {
      this._onDidChange.fire()
      return
    }
    let max = limitLines - curr
    let append = items.slice(0, max)
    this.items = this.items.concat(append)
    if (this.creating) return
    await this.setLines(append.map(item => item.label), curr > 0, this.currIndex)
  }

  private async setLines(lines: string[], append = false, index: number): Promise<void> {
    let { nvim, bufnr, window, config } = this
    if (!bufnr || !window) return
    let resize = config.get<boolean>('autoResize', true)
    let buf = nvim.createBuffer(bufnr)
    nvim.pauseNotification()
    nvim.call('win_gotoid', window.id, true)
    if (resize) {
      let maxHeight = config.get<number>('maxHeight', 12)
      let height = Math.max(1, Math.min(this.items.length, maxHeight))
      if (height != this.height) {
        this.height = height
        window.notify(`nvim_win_set_height`, [height])
        this._onDidChangeHeight.fire()
      }
    }
    nvim.call('clearmatches', [], true)
    if (!append) {
      if (!lines.length) {
        lines = ['Press ? on normal mode to get help.']
        nvim.call('matchaddpos', ['Comment', [[1]], 99], true)
      }
    }
    nvim.command('setl modifiable', true)
    if (workspace.isVim) {
      nvim.call('coc#list#setlines', [lines, append], true)
    } else {
      buf.setLines(lines, { start: append ? -1 : 0, end: -1, strictIndexing: false }, true)
    }
    nvim.command('setl nomodifiable', true)
    if (!append && index == 0) {
      this.doHighlight(0, 500)
    } else {
      this.doHighlight(Math.max(0, index - this.height), Math.min(index + this.height, this.length - 1))
    }
    if (!append) window.notify('nvim_win_set_cursor', [[index + 1, 0]])
    this._onDidChange.fire()
    nvim.resumeNotification(false, true).catch(_e => {
      // noop
    })
  }

  public async restoreWindow(): Promise<void> {
    let { window, height } = this
    if (window && height) {
      let curr = await window.height
      if (curr != height) {
        window.notify(`nvim_win_set_height`, [height])
        this._onDidChangeHeight.fire()
      }
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  public get length(): number {
    return this.items.length
  }

  public get selectedItems(): ListItem[] {
    let { selected, items } = this
    let res: ListItem[] = []
    for (let i of selected) {
      if (items[i - 1]) res.push(items[i - 1])
    }
    return res
  }

  private doHighlight(start: number, end: number): void {
    let { nvim } = workspace
    let { highlights, items } = this
    for (let i = start; i <= Math.min(end, items.length - 1); i++) {
      let { ansiHighlights } = items[i]
      let highlight = highlights[i]
      if (ansiHighlights) {
        for (let hi of ansiHighlights) {
          let { span, hlGroup } = hi
          this.setHighlightGroup(hlGroup)
          nvim.call('matchaddpos', [hlGroup, [[i + 1, span[0] + 1, span[1] - span[0]]], 9], true)
        }
      }
      if (highlight) {
        let { spans, hlGroup } = highlight
        for (let span of spans) {
          nvim.call('matchaddpos', [hlGroup || 'Search', [[i + 1, span[0] + 1, span[1] - span[0]]], 11], true)
        }
      }
    }
  }

  private setHighlightGroup(hlGroup: string): void {
    let { nvim } = workspace
    if (this.hlGroupMap.has(hlGroup)) {
      let cmd = this.hlGroupMap.get(hlGroup)
      this.hlGroupMap.delete(hlGroup)
      nvim.command(cmd, true)
    }
  }

  public setCursor(lnum: number, col: number): void {
    let { window, bufnr, items } = this
    let max = items.length == 0 ? 1 : items.length
    if (!bufnr || !window || lnum > max) return
    window.notify('nvim_win_set_cursor', [[lnum, col]])
    if (this.currIndex + 1 != lnum) {
      this.currIndex = lnum - 1
      this._onDidChangeLine.fire(lnum)
    }
  }

  public addHighlights(highlights: ListHighlights[], append = false): void {
    let limitLines = this.config.get<number>('limitLines', 1000)
    if (!append) {
      this.highlights = highlights.slice(0, limitLines)
    } else {
      if (this.highlights.length < limitLines) {
        this.highlights = this.highlights.concat(highlights.slice(0, limitLines - this.highlights.length))
      }
    }
  }

  private async getSelectedRange(): Promise<[number, number]> {
    let { nvim } = this
    await nvim.call('coc#list#stop_prompt')
    await nvim.eval('feedkeys("\\<esc>", "in")')
    let [, start] = await nvim.call('getpos', "'<")
    let [, end] = await nvim.call('getpos', "'>")
    if (start > end) {
      [start, end] = [end, start]
    }
    let method = workspace.isVim ? 'coc#list#prompt_start' : 'coc#list#start_prompt'
    this.nvim.call(method, [], true)
    return [start, end]
  }
}
