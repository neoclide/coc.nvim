import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { ListItem, ListItemWithHighlights, ListOptions } from '../types'
import { disposeAll } from '../util'
import { Mutex } from '../util/mutex'
import window from '../window'
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
  private drawCount = 0
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
      if (end < 300) return
      if (!this.window || winid != this.window.id) return
      // increment highlights
      nvim.pauseNotification()
      this.doHighlight(start - 1, end)
      nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }, 100)
    this.disposables.push({
      dispose: () => {
        debounced.clear()
      }
    })
    events.on('CursorMoved', debounced, null, this.disposables)
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
    nvim.resumeNotification(false, true).logError()
  }

  public get index(): number {
    return this.currIndex
  }

  public get firstItem(): ListItem {
    return this.items[0]
  }

  public get lastItem(): ListItem {
    return this.items[this.items.length - 1]
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
    }, _e => null)
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
    let winid = await nvim.getVvar('mouse_winid') as number
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

  public async resume(): Promise<void> {
    let { items, selected, nvim, signOffset } = this
    await this.drawItems(items, this.height, true)
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
    return this.window != null
  }

  public get bufnr(): number | undefined {
    return this.buffer?.id
  }

  public get winid(): number | undefined {
    return this.window?.id
  }

  public get ready(): Promise<void> {
    if (this.window) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      let timeout = setTimeout(() => {
        reject(new Error('window create timeout'))
      }, 3000)
      let disposable = this.onDidLineChange(() => {
        disposable.dispose()
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  public async drawItems(items: ListItem[], height: number, reload = false, token?: CancellationToken): Promise<void> {
    let count = this.drawCount = this.drawCount + 1
    const { nvim, name, listOptions } = this
    const release = await this.mutex.acquire()
    this.items = items.length > this.limitLines ? items.slice(0, this.limitLines) : items
    const create = this.window == null
    if (create && !(token && token.isCancellationRequested)) {
      try {
        let { position, numberSelect } = listOptions
        let [bufnr, winid] = await nvim.call('coc#list#create', [position, height, name, numberSelect])
        if (token && token.isCancellationRequested) {
          nvim.call('coc#list#clean_up', [], true)
        } else {
          this.height = height
          this.buffer = nvim.createBuffer(bufnr)
          this.window = nvim.createWindow(winid)
          this._onDidOpen.fire(this.bufnr)
        }
      } catch (e) {
        nvim.call('coc#prompt#stop_prompt', ['list'], true)
        nvim.call('coc#list#clean_up', [], true)
        release()
        window.showMessage(`Error on list create: ${e.message}`, 'error')
        return
      }
    }
    release()
    if (token && token.isCancellationRequested) return
    if (count !== this.drawCount) return

    const lines = this.items.map(item => item.label)

    this.clearSelection()
    let newIndex = reload ? this.currIndex : 0
    await this.setLines(lines, false, newIndex)
    this._onDidLineChange.fire(this.currIndex + 1)
  }

  public async appendItems(items: ListItem[]): Promise<void> {
    if (!this.window) return
    let curr = this.items.length
    if (curr >= this.limitLines) return
    let max = this.limitLines - curr
    let append = items.slice(0, max)
    this.items = this.items.concat(append)
    await this.setLines(append.map(item => item.label), curr > 0, this.currIndex)
  }

  private async setLines(lines: string[], append = false, index: number): Promise<void> {
    let { nvim, buffer, window } = this
    if (!buffer || !window) return
    nvim.pauseNotification()
    if (!append) {
      let statusSegments: Array<String> | null = this.config.get('statusLineSegments')
      if (statusSegments) {
        window.notify('nvim_win_set_option', ['statusline', statusSegments.join(" ")])
      }
      nvim.call('coc#compat#clear_matches', [window.id], true)
      if (!lines.length) {
        lines = ['No results, press ? on normal mode to get help.']
        nvim.call('coc#compat#matchaddpos', ['Comment', [[1]], 99, this.window.id], true)
      }
    }
    buffer.setOption('modifiable', true, true)
    if (workspace.isVim) {
      nvim.call('coc#list#setlines', [buffer.id, lines, append], true)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      buffer.setLines(lines, { start: append ? -1 : 0, end: -1, strictIndexing: false }, true)
    }
    buffer.setOption('modifiable', false, true)
    if (!append && index == 0) {
      this.doHighlight(0, 300)
    } else {
      let height = this.newTab ? workspace.env.lines : this.height
      this.doHighlight(Math.max(0, index - height), Math.min(index + height + 1, this.length - 1))
    }
    if (!append) {
      this.currIndex = index
      window.notify('nvim_win_set_cursor', [[index + 1, 0]])
    }
    nvim.command('redraws', true)
    let res = await nvim.resumeNotification()
    if (Array.isArray(res[1]) && res[1][0] == 0) {
      this.window = null
    }
  }

  public restoreWindow(): void {
    if (this.newTab) return
    let { winid, height } = this
    if (winid && height) {
      this.nvim.call('coc#list#restore', [winid, height], true)
    }
  }

  public reset(): void {
    if (this.window) {
      this.window = null
      this.buffer = null
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this.window = null
    this._onDidChangeLine.dispose()
    this._onDidOpen.dispose()
    this._onDidClose.dispose()
    this._onDidLineChange.dispose()
    this._onDoubleClick.dispose()
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
    let { items } = this
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
    nvim.call('coc#compat#matchaddgroups', [this.window.id, groups], true)
  }

  public setCursor(lnum: number, col: number): void {
    let { window, items } = this
    let max = items.length == 0 ? 1 : items.length
    if (lnum > max) return
    // change index since CursorMoved event not fired (seems bug of neovim)!
    this.onLineChange(lnum - 1)
    if (window) window.notify('nvim_win_set_cursor', [[lnum, col]])
  }

  private async getSelectedRange(): Promise<[number, number]> {
    let { nvim } = this
    await nvim.call('coc#prompt#stop_prompt', ['list'])
    await nvim.eval('feedkeys("\\<esc>", "in")')
    let [, start] = await nvim.call('getpos', "'<")
    let [, end] = await nvim.call('getpos', "'>")
    if (start > end) {
      [start, end] = [end, start]
    }
    this.nvim.call('coc#prompt#start_prompt', ['list'], true)
    return [start, end]
  }
}
