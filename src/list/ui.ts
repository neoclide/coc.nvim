import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { ListHighlights, ListItem, ListOptions } from '../types'
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

const StatusLineOption = [
  '%#CocListMode#-- %{get(b:list_status, "mode", "")} --%*',
  '%{get(g:, "coc_list_loading_status", "")}',
  '%{get(b:list_status, "args", "")}',
  '(%L/%{get(b:list_status, "total", "")})',
  '%=',
  '%#CocListPath# %{get(b:list_status, "cwd", "")} %l/%L%*'
].join(' ')

export default class ListUI {
  private window: Window
  private height: number
  private newTab = false
  private buffer: Buffer
  private currIndex = 0
  private drawCount = 0
  private highlights: ListHighlights[] = []
  private items: ListItem[] = []
  private disposables: Disposable[] = []
  private signOffset: number
  private selected: Set<number> = new Set()
  private mouseDown: MousePosition
  private mutex: Mutex = new Mutex()
  private _onDidChangeLine = new Emitter<number>()
  private _onDidOpen = new Emitter<number>()
  private _onDidClose = new Emitter<number>()
  private _onDidChange = new Emitter<void>()
  private _onDidLineChange = new Emitter<number>()
  private _onDoubleClick = new Emitter<void>()
  public readonly onDidChangeLine: Event<number> = this._onDidChangeLine.event
  public readonly onDidLineChange: Event<number> = this._onDidLineChange.event
  public readonly onDidOpen: Event<number> = this._onDidOpen.event
  public readonly onDidClose: Event<number> = this._onDidClose.event
  public readonly onDidChange: Event<void> = this._onDidChange.event
  public readonly onDidDoubleClick: Event<void> = this._onDoubleClick.event

  constructor(
    private nvim: Neovim,
    private name: string,
    private listOptions: ListOptions,
    private config: ListConfiguration
  ) {
    this.signOffset = config.get<number>('signOffset')
    this.newTab = listOptions.position == 'tab'
    events.on('BufUnload', async bufnr => {
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
      await nvim.resumeNotification(false, true)
    }, 100)
    this.disposables.push({
      dispose: () => {
        debounced.clear()
      }
    })
    events.on('CursorMoved', debounced, null, this.disposables)
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

  public async drawItems(items: ListItem[], height: number, reload = false): Promise<void> {
    let count = this.drawCount = this.drawCount + 1
    const { config, nvim, name, listOptions } = this
    const release = await this.mutex.acquire()
    let limitLines = config.get<number>('limitLines', 30000)
    this.items = items.slice(0, limitLines)
    const create = this.window == null
    if (create) {
      try {
        let { position, numberSelect } = listOptions
        let [bufnr, winid] = await nvim.call('coc#list#create', [position, height, name, numberSelect])
        this.height = height
        this.buffer = nvim.createBuffer(bufnr)
        this.window = nvim.createWindow(winid)
        this._onDidOpen.fire(this.bufnr)
      } catch (e) {
        release()
        workspace.showMessage(`Error on list create: ${e.message}`, 'error')
        return
      }
    }
    release()
    if (count !== this.drawCount) return
    let lines = this.items.map(item => item.label)
    this.clearSelection()
    let newIndex = reload ? this.currIndex : 0
    await this.setLines(lines, false, newIndex)
    this._onDidLineChange.fire(this.currIndex + 1)
  }

  public async appendItems(items: ListItem[]): Promise<void> {
    if (!this.window) return
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
    await this.setLines(append.map(item => item.label), curr > 0, this.currIndex)
  }

  private async setLines(lines: string[], append = false, index: number): Promise<void> {
    let { nvim, bufnr, window } = this
    if (!bufnr || !window) return
    let buf = nvim.createBuffer(bufnr)
    nvim.pauseNotification()
    if (!append) {
      window.notify('nvim_win_set_option', ['statusline', StatusLineOption])
    }
    nvim.call('win_gotoid', window.id, true)
    if (!append) {
      nvim.call('clearmatches', [], true)
      if (!lines.length) {
        lines = ['No results, press ? on normal mode to get help.']
        nvim.call('matchaddpos', ['Comment', [[1]], 99], true)
      }
    }
    nvim.command('setl modifiable', true)
    if (workspace.isVim) {
      nvim.call('coc#list#setlines', [lines, append], true)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      buf.setLines(lines, { start: append ? -1 : 0, end: -1, strictIndexing: false }, true)
    }
    nvim.command('setl nomodifiable', true)
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
    this._onDidChange.fire()
    if (workspace.isVim) nvim.command('redraw', true)
    let res = await nvim.resumeNotification()
    if (res && res[1]) logger.error(res[1])
  }

  public restoreWindow(): void {
    if (this.newTab) return
    let { window, height } = this
    if (window && height) {
      this.nvim.call('coc#list#restore', [window.id, height], true)
    }
  }

  public close(): void {
    if (this.window) {
      this.window.close(true, true)
      this.window = null
    }
  }

  public dispose(): void {
    this.close()
    disposeAll(this.disposables)
    this._onDidChangeLine.dispose()
    this._onDidOpen.dispose()
    this._onDidClose.dispose()
    this._onDidChange.dispose()
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
    let { highlights, items } = this
    for (let i = start; i <= Math.min(end, items.length - 1); i++) {
      let { ansiHighlights } = items[i]
      let highlight = highlights[i]
      if (ansiHighlights) {
        for (let hi of ansiHighlights) {
          let { span, hlGroup } = hi
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

  public setCursor(lnum: number, col: number): void {
    let { window, items } = this
    let max = items.length == 0 ? 1 : items.length
    if (lnum > max) return
    // change index since CursorMoved event not fired (seems bug of neovim)!
    this.onLineChange(lnum - 1)
    if (window) window.notify('nvim_win_set_cursor', [[lnum, col]])
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
