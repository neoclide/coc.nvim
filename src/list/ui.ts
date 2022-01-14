import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { ListItem, ListItemWithHighlights, ListOptions } from '../types'
import { disposeAll } from '../util'
import { Mutex } from '../util/mutex'
import workspace from '../workspace'
import ListConfiguration from './configuration'
const logger = require('../util/logger')('list-ui')

export type MouseEvent = 'mouseDown' | 'mouseDrag' | 'mouseUp' | 'doubleClick'

export interface MousePosition {
  winid: number
  lnum: number
  col: number
  current: boolean
}

export interface HighlightGroup {
  hlGroup: string
  priority: number
  pos: [number, number, number]
}

export default class ListUI {
  private window: Window
  private height: number
  private newTab = false
  private buffer: Buffer
  private currIndex = 0
  private items: ListItemWithHighlights[] = []
  private disposables: Disposable[] = []
  private signOffset: number
  private matchHighlightGroup: string
  private selected: Set<number> = new Set()
  private mouseDown: MousePosition
  private mutex: Mutex = new Mutex()
  private _onDidChangeLine = new Emitter<number>()
  private _onDidOpen = new Emitter<number>()
  private _onDidClose = new Emitter<number>()
  private _onDidLineChange = new Emitter<number>()
  private _onDoubleClick = new Emitter<void>()
  public readonly onDidChangeLine: Event<number> = this._onDidChangeLine.event
  public readonly onDidLineChange: Event<number> = this._onDidLineChange.event
  public readonly onDidOpen: Event<number> = this._onDidOpen.event
  public readonly onDidClose: Event<number> = this._onDidClose.event
  public readonly onDidDoubleClick: Event<void> = this._onDoubleClick.event

  constructor(
    private nvim: Neovim,
    private name: string,
    private listOptions: ListOptions,
    private config: ListConfiguration
  ) {
    this.signOffset = config.get<number>('signOffset')
    this.matchHighlightGroup = config.get<string>('matchHighlightGroup', 'Search')
    this.newTab = listOptions.position == 'tab'
    events.on('BufWinLeave', async bufnr => {
      if (bufnr != this.bufnr || this.window == null) return
      this.window = null
      this._onDidClose.fire(bufnr)
    }, null, this.disposables)
    events.on('CursorMoved', async (bufnr, cursor) => {
      if (bufnr != this.bufnr) return
      this.onLineChange(cursor[0] - 1)
    }, null, this.disposables)
    let debounced = debounce(async bufnr => {
      if (bufnr != this.bufnr) return
      let [winid, start, end] = await nvim.eval('[win_getid(),line("w0"),line("w$")]') as number[]
      if (end < 300 || winid != this.winid) return
      // increment highlights
      nvim.pauseNotification()
      this.doHighlight(start - 1, end)
      nvim.command('redraw', true)
      void nvim.resumeNotification(false, true)
    }, 100)
    this.disposables.push({
      dispose: () => {
        debounced.clear()
      }
    })
    events.on('CursorMoved', debounced, null, this.disposables)
  }

  public get bufnr(): number | undefined {
    return this.buffer?.id
  }

  public get winid(): number | undefined {
    return this.window?.id
  }
  private get limitLines(): number {
    return this.config.get<number>('limitLines', 30000)
  }

  private onLineChange(index: number): void {
    if (this.currIndex == index) return
    this.currIndex = index
    this._onDidChangeLine.fire(index)
  }

  public set index(n: number) {
    if (n < 0 || n >= this.items.length) return
    let { nvim } = this
    nvim.pauseNotification()
    this.setCursor(n + 1, 0)
    nvim.command('redraw', true)
    void nvim.resumeNotification(false, true)
  }

  public get index(): number {
    return this.currIndex
  }

  public getItem(index: number): ListItem {
    return this.items[index]
  }

  public get item(): Promise<ListItem> {
    let { window } = this
    if (!window) return Promise.resolve(null)
    return window.cursor.then(cursor => {
      this.currIndex = cursor[0] - 1
      return this.items[this.currIndex]
    })
  }

  public async echoMessage(item: ListItem): Promise<void> {
    let { items } = this
    let idx = items.indexOf(item)
    let msg = `[${idx + 1}/${items.length}] ${item.label || ''}`
    this.nvim.callTimer('coc#util#echo_lines', [[msg]], true)
  }

  public async updateItem(item: ListItem, index: number): Promise<void> {
    if (!this.buffer) return
    let obj: ListItem = Object.assign({ resolved: true }, item)
    if (index >= this.length) return
    this.items[index] = obj
    let { nvim } = this
    nvim.pauseNotification()
    this.buffer.setOption('modifiable', true, true)
    nvim.call('setbufline', [this.bufnr, index + 1, obj.label], true)
    this.buffer.setOption('modifiable', false, true)
    await nvim.resumeNotification()
  }

  public async getItems(): Promise<ListItem[]> {
    if (this.length == 0 || !this.window) return []
    let mode = await this.nvim.call('mode')
    if (mode == 'v' || mode == 'V') {
      let [start, end] = await this.getSelectedRange()
      let res: ListItem[] = []
      for (let i = start; i <= end; i++) {
        let item = this.items[i - 1]
        if (item) res.push(item)
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
    if (!window) return
    let [winid, lnum, col] = await nvim.eval(`[v:mouse_winid,v:mouse_lnum,v:mouse_col]`) as [number, number, number]
    if (event == 'mouseDown') {
      this.mouseDown = { winid, lnum, col, current: winid == window.id }
      return
    }
    let current = winid == window.id
    if (current && event == 'doubleClick') {
      this.setCursor(lnum, 0)
      this._onDoubleClick.fire()
    }
    if (current && event == 'mouseDrag') {
      if (!this.mouseDown) return
      await this.selectLines(this.mouseDown.lnum, lnum)
    } else if (current && event == 'mouseUp') {
      if (!this.mouseDown) return
      if (this.mouseDown.lnum == lnum) {
        this.setCursor(lnum, 0)
        nvim.command('redraw', true)
      } else {
        await this.selectLines(this.mouseDown.lnum, lnum)
      }
    } else if (!current && event == 'mouseUp') {
      nvim.pauseNotification()
      nvim.call('win_gotoid', winid, true)
      nvim.call('cursor', [lnum, col], true)
      nvim.command('redraw', true)
      void nvim.resumeNotification(false, true)
    }
  }

  public async resume(): Promise<void> {
    let { items, selected, nvim } = this
    await this.drawItems(items, this.height, true)
    if (!selected.size || !this.buffer) return
    nvim.pauseNotification()
    for (let lnum of selected) {
      this.buffer?.placeSign({ lnum, id: this.signOffset + lnum, name: 'CocSelected', group: 'coc-list' })
    }
    nvim.command('redraw', true)
    void nvim.resumeNotification(false, true)
  }

  public async toggleSelection(): Promise<void> {
    let { nvim } = this
    await nvim.call('win_gotoid', [this.winid])
    let lnum = await nvim.call('line', '.')
    let mode = await nvim.call('mode')
    if (mode == 'v' || mode == 'V') {
      let [start, end] = await this.getSelectedRange()
      let reverse = start > end
      if (reverse) [start, end] = [end, start]
      for (let i = start; i <= end; i++) {
        this.toggleLine(i)
      }
      this.setCursor(end, 0)
      nvim.command('redraw', true)
      await nvim.resumeNotification()
      return
    }
    nvim.pauseNotification()
    this.toggleLine(lnum)
    this.setCursor(lnum + 1, 0)
    nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  private toggleLine(lnum: number): void {
    let { selected, buffer, signOffset } = this
    let exists = selected.has(lnum)
    if (!exists) {
      selected.add(lnum)
      buffer.placeSign({ lnum, id: signOffset + lnum, name: 'CocSelected', group: 'coc-list' })
    } else {
      selected.delete(lnum)
      buffer.unplaceSign({ id: signOffset + lnum, group: 'coc-list' })
    }
  }

  public async selectLines(start: number, end: number): Promise<void> {
    let { nvim, signOffset, buffer, length } = this
    this.clearSelection()
    let { selected } = this
    nvim.pauseNotification()
    let reverse = start > end
    if (reverse) [start, end] = [end, start]
    for (let i = start; i <= end; i++) {
      if (i > length) break
      selected.add(i)
      buffer.placeSign({ lnum: i, id: signOffset + i, name: 'CocSelected', group: 'coc-list' })
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
    let { selected, signOffset, buffer } = this
    if (selected.size > 0) {
      let signIds: number[] = []
      for (let lnum of selected) {
        signIds.push(signOffset + lnum)
      }
      buffer?.unplaceSign({ group: 'coc-list' })
      this.selected.clear()
    }
  }

  public get ready(): Promise<void> {
    if (this.window) return Promise.resolve()
    return new Promise<void>(resolve => {
      let disposable = this.onDidLineChange(() => {
        disposable.dispose()
        resolve()
      })
    })
  }

  public async drawItems(items: ListItem[], height: number, reload = false): Promise<void> {
    const { nvim, name, listOptions } = this
    this.items = items.length > this.limitLines ? items.slice(0, this.limitLines) : items
    let release = await this.mutex.acquire()
    if (!this.window) {
      let { position, numberSelect } = listOptions
      let [bufnr, winid] = await nvim.call('coc#list#create', [position, height, name, numberSelect])
      this.height = height
      this.buffer = nvim.createBuffer(bufnr)
      let win = this.window = nvim.createWindow(winid)
      let statusSegments = this.config.get<string[]>('statusLineSegments')
      if (statusSegments) win.setOption('statusline', statusSegments.join(" "), true)
      this._onDidOpen.fire(this.bufnr)
    }
    const lines = this.items.map(item => item.label)
    let newIndex = reload ? this.currIndex : 0
    this.setLines(lines, false, newIndex)
    this._onDidLineChange.fire(this.currIndex + 1)
    release()
  }

  public async appendItems(items: ListItem[]): Promise<void> {
    let release = await this.mutex.acquire()
    if (this.window) {
      let curr = this.items.length
      if (curr < this.limitLines) {
        let max = this.limitLines - curr
        let append = items.slice(0, max)
        this.items = this.items.concat(append)
        this.setLines(append.map(item => item.label), curr > 0, this.currIndex)
      }
    }
    release()
  }

  private setLines(lines: string[], append = false, index: number): void {
    let { nvim, buffer, window } = this
    if (!buffer || !window) return
    nvim.pauseNotification()
    if (!append) {
      nvim.call('coc#compat#clear_matches', [window.id], true)
      if (!lines.length) {
        lines = ['No results, press ? on normal mode to get help.']
        nvim.call('coc#compat#matchaddpos', ['Comment', [[1]], 99, window.id], true)
      }
    }
    buffer.setOption('modifiable', true, true)
    void buffer.setLines(lines, { start: append ? -1 : 0, end: -1, strictIndexing: false }, true)
    buffer.setOption('modifiable', false, true)
    if (!append && index == 0) {
      this.doHighlight(0, 299)
    } else {
      let height = this.newTab ? workspace.env.lines : this.height
      this.doHighlight(Math.max(0, index - height), Math.min(index + height + 1, this.length - 1))
    }
    if (!append) {
      this.currIndex = index
      window.setCursor([index + 1, 0], true)
    }
    nvim.command('redraws', true)
    void nvim.resumeNotification(false, true)
  }

  public restoreWindow(): void {
    if (this.newTab) return
    let { winid, height } = this
    if (winid && height) {
      this.nvim.call('coc#list#restore', [winid, height], true)
    }
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
    let { items, nvim, window } = this
    if (!window) return
    let groups: HighlightGroup[] = []
    for (let i = start; i <= Math.min(end, items.length - 1); i++) {
      let { ansiHighlights, highlights } = items[i]
      if (ansiHighlights) {
        for (let hi of ansiHighlights) {
          let { span, hlGroup } = hi
          groups.push({ hlGroup, priority: 9, pos: [i + 1, span[0] + 1, span[1] - span[0]] })
        }
      }
      if (highlights && Array.isArray(highlights.spans)) {
        let { spans, hlGroup } = highlights
        for (let span of spans) {
          groups.push({ hlGroup: hlGroup || this.matchHighlightGroup, priority: 11, pos: [i + 1, span[0] + 1, span[1] - span[0]] })
        }
      }
    }
    nvim.call('coc#compat#matchaddgroups', [window.id, groups], true)
  }

  public setCursor(lnum: number, col: number): void {
    let { items } = this
    let max = items.length == 0 ? 1 : items.length
    if (lnum > max) return
    // change index since CursorMoved event not fired (seems bug of neovim)!
    this.onLineChange(lnum - 1)
    this.window?.setCursor([lnum, col], true)
  }

  private async getSelectedRange(): Promise<[number, number]> {
    let { nvim } = this
    await nvim.call('coc#prompt#stop_prompt', ['list'])
    await nvim.eval('feedkeys("\\<esc>", "in")')
    let [, start] = await nvim.call('getpos', "'<")
    let [, end] = await nvim.call('getpos', "'>")
    this.nvim.call('coc#prompt#start_prompt', ['list'], true)
    return [start, end]
  }

  public reset(): void {
    if (this.window) {
      this.window = null
      this.buffer = null
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.nvim.call('coc#window#close', [this.winid || -1], true)
    this.window = null
    this.buffer = null
    this.items = []
    this._onDidChangeLine.dispose()
    this._onDidOpen.dispose()
    this._onDidClose.dispose()
    this._onDidLineChange.dispose()
    this._onDoubleClick.dispose()
  }
}
