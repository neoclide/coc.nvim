import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, Emitter, Event, MarkupContent, MarkupKind } from 'vscode-languageserver-protocol'
import commandManager from '../commands'
import events from '../events'
import FloatFactory from '../model/floatFactory'
import { ConfigurationChangeEvent, Documentation, HighlightItem } from '../types'
import { disposeAll } from '../util'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
import { byteLength, byteSlice } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { TreeDataProvider, TreeView, TreeViewExpansionEvent, TreeViewOptions, TreeViewSelectionChangeEvent, TreeViewVisibilityChangeEvent } from './index'
import { TreeItem, TreeItemCollapsibleState } from './TreeItem'
const logger = require('../util/logger')('BasicTreeView')
const highlightNamespace = 'tree'
const signOffset = 3000
let globalId = 1

interface TreeViewConfig {
  openedIcon: string
  closedIcon: string
}

interface RenderedItem<T> {
  line: string
  level: number
  node: T
}

interface LineState {
  /**
   * Line count used by message
   */
  messageCount: number
  /**
   * Line count used by title
   */
  titleCount: number
}

interface Keys {
  invoke?: string
  toggle?: string
  collapseAll?: string
  toggleSelection?: string
  close?: string
}

interface RenderOptions<T> {
  highlights: HighlightItem[]
  items: RenderedItem<T>[]
}

interface TreeItemData {
  item: TreeItem
  resolved: boolean
}

/**
 * Basic TreeView implementation
 */
export default class BasicTreeView<T> implements TreeView<T> {
  // Resolved TreeItems
  private bufnr: number | undefined
  private winid: number | undefined
  private config: TreeViewConfig
  private keys: Keys
  private _creating: boolean
  private _selection: T[] = []
  private _onDidExpandElement = new Emitter<TreeViewExpansionEvent<T>>()
  private _onDidCollapseElement = new Emitter<TreeViewExpansionEvent<T>>()
  private _onDidChangeSelection = new Emitter<TreeViewSelectionChangeEvent<T>>()
  private _onDidChangeVisibility = new Emitter<TreeViewVisibilityChangeEvent>()
  public onDidExpandElement: Event<TreeViewExpansionEvent<T>> = this._onDidExpandElement.event
  public onDidCollapseElement: Event<TreeViewExpansionEvent<T>> = this._onDidCollapseElement.event
  public onDidChangeSelection: Event<TreeViewSelectionChangeEvent<T>> = this._onDidChangeSelection.event
  public onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent> = this._onDidChangeVisibility.event
  public message: string | undefined
  public title: string
  public description: string | undefined
  private renderedItems: RenderedItem<T>[] = []
  private provider: TreeDataProvider<T>
  private readonly canSelectMany: boolean
  private readonly leafIndent: boolean
  private readonly winfixwidth: boolean
  private readonly checkCollapseState: boolean
  private lineState: LineState = { titleCount: 0, messageCount: 0 }
  private nodesMap: Map<T, TreeItemData> = new Map()
  private mutex: Mutex = new Mutex()
  private timer: NodeJS.Timer
  private disposables: Disposable[] = []
  private tooltipFactory: FloatFactory
  private resolveTokenSource: CancellationTokenSource | undefined
  constructor(private viewId: string, opts: TreeViewOptions<T>) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    this.tooltipFactory = new FloatFactory(workspace.nvim)
    this.canSelectMany = !!opts.canSelectMany
    this.provider = opts.treeDataProvider
    this.leafIndent = opts.disableLeafIndent !== true
    this.winfixwidth = opts.winfixwidth !== false
    this.checkCollapseState = opts.checkCollapseState !== false
    let message: string | undefined
    Object.defineProperty(this, 'message', {
      set: (msg: string | undefined) => {
        message = msg ? msg.replace(/\r?\n/g, ' ') : undefined
        this.changeMessageLine(message).logError()
      },
      get: () => {
        return message
      }
    })
    let title = viewId.replace(/\r?\n/g, ' ')
    Object.defineProperty(this, 'title', {
      set: (newTitle: string) => {
        title = newTitle ? newTitle.replace(/\r?\n/g, ' ') : undefined
        this.changeTitleLine(title, this.description).logError()
      },
      get: () => {
        return title
      }
    })
    let description: string | undefined
    Object.defineProperty(this, 'description', {
      set: (desc: string | undefined) => {
        description = desc ? desc.replace(/\r?\n/g, ' ') : undefined
        this.changeTitleLine(this.title, description).logError()
      },
      get: () => {
        return description
      }
    })
    this.provider.onDidChangeTreeData(this.onDataChange, this, this.disposables)
    events.on('BufUnload', bufnr => {
      if (bufnr != this.bufnr) return
      this.winid = undefined
      this.bufnr = undefined
      this._onDidChangeVisibility.fire({ visible: false })
      this.dispose()
    }, null, this.disposables)
    events.on('CursorHold', async bufnr => {
      if (bufnr != this.bufnr) return
      await this.onHover()
    }, null, this.disposables)
    events.on(['CursorMoved', 'BufEnter'], () => {
      this.cancelResolve()
    }, null, this.disposables)
    this.disposables.push(this._onDidChangeVisibility, this._onDidChangeSelection, this._onDidCollapseElement, this._onDidExpandElement)
  }

  public get windowId(): number | undefined {
    return this.winid
  }

  private get startLnum(): number {
    return this.lineState.messageCount + this.lineState.titleCount
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('tree')) {
      let config = workspace.getConfiguration('tree')
      this.config = {
        openedIcon: config.get('openedIcon', ' '),
        closedIcon: config.get('closedIcon', ' ')
      }
      this.keys = {
        close: config.get<string>('key.close'),
        invoke: config.get<string>('key.invoke'),
        toggle: config.get<string>('key.toggle'),
        collapseAll: config.get<string>('key.collapseAll'),
        toggleSelection: config.get<string>('key.toggleSelection'),
      }
      if (e) {
        void this.render()
      }
    }
  }

  private async onHover(): Promise<void> {
    let { nvim } = this
    let lnum = await nvim.call('line', ['.'])
    let element = this.getElementByLnum(lnum - 1)
    if (!element) return
    let obj = this.nodesMap.get(element)
    if (!obj) return
    let item = obj.item
    if (!obj.resolved) {
      item = await this.resolveItem(element, item)
      if (!item) return
    }
    if (!item.tooltip || !this.bufnr) return
    let isMarkdown = MarkupContent.is(item.tooltip) && item.tooltip.kind == MarkupKind.Markdown
    let doc: Documentation = {
      filetype: isMarkdown ? 'markdown' : 'txt',
      content: MarkupContent.is(item.tooltip) ? item.tooltip.value : item.tooltip
    }
    await this.tooltipFactory.show([doc], { modes: ['n'] })
  }

  private async onClick(element: T): Promise<void> {
    let { nvim } = this
    let [line, col] = await nvim.eval(`[getline('.'),col('.')]`) as [string, number]
    let pre = byteSlice(line, 0, col - 1)
    let character = line[pre.length]
    if (!character) return
    let { openedIcon, closedIcon } = this.config
    if (/^\s*$/.test(pre) && [openedIcon, closedIcon].includes(character)) {
      await this.toggleExpand(element)
    } else {
      await this.invokeCommand(element)
    }
  }

  private async invokeCommand(element: T): Promise<void> {
    let obj = this.nodesMap.get(element)
    if (!obj) return
    let item = obj.item
    if (!obj.resolved && !item.command) {
      item = await this.resolveItem(element, item)
      if (!item) return
    }
    if (!item.command) throw new Error(`Failed to resolve command from TreeItem.`)
    await commandManager.execute(item.command)
  }

  private async changeMessageLine(msg: string): Promise<void> {
    if (!this.bufnr) return
    // add or remove message lines
    let release = await this.mutex.acquire()
    try {
      let { messageCount } = this.lineState
      if (msg) {
        let highlights = [{ hlGroup: 'MoreMsg', colStart: 0, colEnd: byteLength(msg), lnum: 0 }]
        this.updateUI([msg, ''], highlights, 0, messageCount)
        this.lineState.messageCount = 2
      } else if (messageCount) {
        this.updateUI([], [], 0, messageCount)
        this.lineState.messageCount = 0
      }
      release()
    } catch (e) {
      release()
      logger.error('Error on change message lines:', e)
    }
  }

  private async changeTitleLine(title: string | undefined, description: string | undefined): Promise<void> {
    if (!this.bufnr) return
    let release = await this.mutex.acquire()
    try {
      let { messageCount, titleCount } = this.lineState
      if (!title) {
        if (titleCount) {
          this.updateUI([], [], messageCount, messageCount + 1)
        }
      } else {
        let lines: string[] = []
        let highlights: HighlightItem[] = []
        highlights.push({ hlGroup: 'CocTreeTitle', colStart: 0, colEnd: byteLength(title), lnum: messageCount })
        if (description) {
          let colStart = byteLength(title) + 1
          highlights.push({ hlGroup: 'Comment', colStart, colEnd: colStart + byteLength(description), lnum: messageCount })
        }
        lines.push(title + (description ? ' ' + description : ''))
        this.updateUI(lines, highlights, messageCount, messageCount + titleCount)
      }
      this.lineState.titleCount = title ? 1 : 0
      release()
    } catch (e) {
      release()
      logger.error('Error on change title line:', e)
    }
  }

  private async onDataChange(node: T | undefined): Promise<void> {
    if (!node) {
      await this.render()
      return
    }
    let release = await this.mutex.acquire()
    try {
      let items = this.renderedItems
      let idx = items.findIndex(o => o.node === node)
      if (idx != -1 && this.bufnr) {
        let obj = items[idx]
        let level = obj.level
        let removeCount = 0
        for (let i = idx; i < items.length; i++) {
          let o = items[i]
          if (i == idx || o && o.level > level) {
            removeCount += 1
          }
        }
        let appendItems: RenderedItem<T>[] = []
        let highlights: HighlightItem[] = []
        let start = idx + this.startLnum
        await this.appendTreeNode(node, level, start, appendItems, highlights)
        items.splice(idx, removeCount, ...appendItems)
        this.updateUI(appendItems.map(o => o.line), highlights, start, start + removeCount)
      }
      release()
    } catch (e) {
      let errMsg = `Error on tree refresh: ${e.message}`
      logger.error(errMsg, e)
      window.showMessage(errMsg, 'error')
      release()
    }
  }

  private async resolveItem(element: T, item: TreeItem): Promise<TreeItem | undefined> {
    if (typeof this.provider.resolveTreeItem === 'function') {
      let tokenSource = this.resolveTokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      item = await Promise.resolve(this.provider.resolveTreeItem(item, element, token))
      tokenSource.dispose()
      this.resolveTokenSource = undefined
      if (token.isCancellationRequested) return undefined
    }
    this.nodesMap.set(element, { item, resolved: true })
    return item
  }

  public get visible(): boolean {
    return this.winid != null
  }

  public get selection(): T[] {
    return this._selection.slice()
  }

  public async checkLines(): Promise<boolean> {
    if (!this.bufnr) return
    let buf = this.nvim.createBuffer(this.bufnr)
    let curr = await buf.lines
    let { titleCount, messageCount } = this.lineState
    curr = curr.slice(titleCount + messageCount)
    let lines = this.renderedItems.map(o => o.line)
    return equals(curr, lines)
  }

  /**
   * Expand/collapse TreeItem.
   */
  private async toggleExpand(element: T): Promise<void> {
    let o = this.nodesMap.get(element)
    if (!o) return
    let treeItem = o.item
    let lnum = this.getItemLnum(element)
    let nodeIdx = lnum - this.startLnum
    let obj = this.renderedItems[nodeIdx]
    if (!obj || treeItem.collapsibleState == TreeItemCollapsibleState.None) return
    // remove lines
    let removeCount = 0
    if (treeItem.collapsibleState == TreeItemCollapsibleState.Expanded) {
      let level = obj.level
      for (let i = nodeIdx + 1; i < this.renderedItems.length; i++) {
        let o = this.renderedItems[i]
        if (!o || o.level <= level) break
        removeCount += 1
      }
      treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed
    } else if (treeItem.collapsibleState == TreeItemCollapsibleState.Collapsed) {
      treeItem.collapsibleState = TreeItemCollapsibleState.Expanded
    }
    let newItems: RenderedItem<T>[] = []
    let newHighlights: HighlightItem[] = []
    await this.appendTreeNode(obj.node, obj.level, lnum, newItems, newHighlights)
    this.renderedItems.splice(nodeIdx, removeCount + 1, ...newItems)
    this.updateUI(newItems.map(o => o.line), newHighlights, lnum, lnum + removeCount + 1)
    if (treeItem.collapsibleState == TreeItemCollapsibleState.Collapsed) {
      this._onDidCollapseElement.fire({ element })
    } else {
      this._onDidExpandElement.fire({ element })
    }
  }

  private toggleSelection(element: T): void {
    let idx = this._selection.findIndex(o => o === element)
    if (idx !== -1) {
      this.unselectItem(idx)
    } else {
      this.selectItem(element)
    }
  }

  private selectItem(item: T): void {
    let { nvim } = this
    if (this._selection.includes(item)
      || !this.bufnr
      || !workspace.env.sign) return
    let row = this.getItemLnum(item)
    if (row == null) return
    if (!this.canSelectMany) {
      this._selection = [item]
    } else {
      this._selection.push(item)
    }
    nvim.pauseNotification()
    if (!this.canSelectMany) {
      nvim.call('sign_unplace', ['CocTree', { buffer: this.bufnr }], true)
    }
    nvim.call('coc#compat#execute', [this.winid, `exe ${row + 1}`], true)
    nvim.call('sign_place', [signOffset + row, 'CocTree', 'CocTreeSelected', this.bufnr, { lnum: row + 1 }], true)
    void nvim.resumeNotification(false, true)
    this._onDidChangeSelection.fire({ selection: this._selection })
  }

  private unselectItem(idx: number): void {
    let item = this._selection[idx]
    let row = this.getItemLnum(item)
    if (row == null || !this.bufnr || !workspace.env.sign) return
    this._selection.splice(idx, 1)
    this.nvim.call('sign_unplace', ['CocTree', { buffer: this.bufnr, id: signOffset + row }], true)
    this._onDidChangeSelection.fire({ selection: this._selection })
  }

  public focusItem(element: T): void {
    if (!this.winid) return
    let lnum = this.getItemLnum(element)
    if (lnum == null) return
    let { nvim } = this
    nvim.pauseNotification()
    nvim.call('win_gotoid', [this.winid], true)
    nvim.command(`exe ${lnum + 1}`, true)
    void nvim.resumeNotification(false, true)
  }

  private getElementByLnum(lnum: number): T | undefined {
    let item = this.renderedItems[lnum - this.startLnum]
    return item ? item.node : undefined
  }

  private getItemLnum(item: T): number | undefined {
    let idx = this.renderedItems.findIndex(o => o.node === item)
    if (idx == -1) return undefined
    return this.startLnum + idx
  }

  private async getTreeItem(element: T): Promise<TreeItem> {
    let obj = this.nodesMap.get(element)
    if (obj != null) return obj.item
    let item = await Promise.resolve(this.provider.getTreeItem(element))
    if (!item) throw new Error('Unable to resolve tree item')
    let resolved = false
    if (item.id) {
      for (let obj of this.nodesMap.values()) {
        if (obj.item.id === item.id) {
          resolved = obj.resolved
          item.collapsibleState = obj.item.collapsibleState
          break
        }
      }
    }
    this.nodesMap.set(element, { item, resolved })
    return item
  }

  private getRenderedLine(treeItem: TreeItem, lnum: number, level: number, highlights: HighlightItem[]): string {
    let { openedIcon, closedIcon } = this.config
    let prefix = '  '.repeat(level)
    const addHighlight = (text: string, hlGroup: string) => {
      let colStart = byteLength(prefix)
      highlights.push({
        lnum,
        hlGroup,
        colStart,
        colEnd: colStart + byteLength(text),
      })
    }
    switch (treeItem.collapsibleState) {
      case TreeItemCollapsibleState.Expanded: {
        addHighlight(openedIcon, 'CocTreeOpenClose')
        prefix += openedIcon + ' '
        break
      }
      case TreeItemCollapsibleState.Collapsed: {
        addHighlight(closedIcon, 'CocTreeOpenClose')
        prefix += closedIcon + ' '
        break
      }
      default:
        prefix += this.leafIndent ? '  ' : ''
    }
    if (treeItem.icon) {
      let { text, hlGroup } = treeItem.icon
      addHighlight(text, hlGroup)
      prefix += text + ' '
    }
    prefix += treeItem.label
    return prefix
  }

  private async appendTreeNode(element: T, level: number, lnum: number, items: RenderedItem<T>[], highlights: HighlightItem[]): Promise<number> {
    let takes = 1
    let treeItem = await this.getTreeItem(element)
    let children
    if (this.checkCollapseState) {
      children = await Promise.resolve(this.provider.getChildren(element))
      if (children?.length) {
        if (treeItem.collapsibleState == TreeItemCollapsibleState.None) {
          treeItem.collapsibleState = TreeItemCollapsibleState.Collapsed
        }
      } else {
        treeItem.collapsibleState = TreeItemCollapsibleState.None
      }
    }
    let line = this.getRenderedLine(treeItem, lnum, level, highlights)
    items.push({ level, line, node: element })
    if (treeItem.collapsibleState == TreeItemCollapsibleState.Expanded) {
      let l = level + 1
      if (!children) {
        children = await Promise.resolve(this.provider.getChildren(element))
        children = children || []
      }
      for (let el of children) {
        let n = await this.appendTreeNode(el, l, lnum + takes, items, highlights)
        takes = takes + n
      }
    }
    return takes
  }

  private updateUI(lines: string[], highlights: HighlightItem[], start = 0, end = -1): void {
    if (!this.bufnr) return
    let { nvim } = this
    let buf = nvim.createBuffer(this.bufnr)
    nvim.pauseNotification()
    buf.setOption('modifiable', true, true)
    void buf.setLines(lines, { start, end, strictIndexing: false }, true)
    if (highlights.length) {
      nvim.call('coc#highlight#update_highlights', [this.bufnr, highlightNamespace, highlights, 0, -1], true)
    }
    buf.setOption('modifiable', false, true)
    if (workspace.env.isVim) nvim.command('redraw', true)
    void nvim.resumeNotification(false, true)
  }

  public async reveal(element: T, options: { select?: boolean; focus?: boolean; expand?: number | boolean } = {}): Promise<void> {
    let { select, focus, expand } = options
    let curr = element
    if (typeof this.provider.getParent !== 'function') {
      throw new Error('missing getParent function from provider for reveal.')
    }
    while (curr) {
      let parentNode = await Promise.resolve(this.provider.getParent(curr))
      if (parentNode) {
        let item = await this.getTreeItem(parentNode)
        item.collapsibleState = TreeItemCollapsibleState.Expanded
        curr = parentNode
      } else {
        break
      }
    }
    if (expand) {
      let item = await this.getTreeItem(element)
      if (item.collapsibleState == TreeItemCollapsibleState.None) return
      item.collapsibleState = TreeItemCollapsibleState.Expanded
      if (typeof expand === 'number' && expand > 1) {
        let curr = Math.min(expand, 2)
        let nodes = await Promise.resolve(this.provider.getChildren(element))
        while (nodes.length > 0) {
          let arr: T[] = []
          for (let n of nodes) {
            let item = await this.getTreeItem(n)
            if (item.collapsibleState == TreeItemCollapsibleState.None) continue
            item.collapsibleState = TreeItemCollapsibleState.Expanded
            if (curr > 1) {
              let res = await Promise.resolve(this.provider.getChildren(n))
              arr.push(...res)
            }
          }
          nodes = arr
          curr = curr - 1
        }
      }
    }
    // render buffer
    await this.render()
    if (select !== false) this.selectItem(element)
    if (focus) this.focusItem(element)
  }

  private addHeadLines(lines: string[], highlights: HighlightItem[]): void {
    if (this.message) {
      highlights.push({ hlGroup: 'MoreMsg', colStart: 0, colEnd: byteLength(this.message), lnum: 0 })
      lines.push(this.message)
      lines.push('')
    }
    this.lineState.messageCount = this.message ? 2 : 0
    if (this.title) {
      highlights.push({ hlGroup: 'CocTreeTitle', colStart: 0, colEnd: byteLength(this.title), lnum: lines.length })
      if (this.description) {
        let colStart = byteLength(this.title) + 1
        highlights.push({ hlGroup: 'Comment', colStart, colEnd: colStart + byteLength(this.description), lnum: lines.length })
      }
      lines.push(this.title + (this.description ? ' ' + this.description : ''))
    }
    this.lineState.titleCount = this.title ? 1 : 0
  }

  // Render all tree items
  private async render(): Promise<void> {
    if (!this.bufnr) return
    let release = await this.mutex.acquire()
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    try {
      let renderedItems: RenderedItem<T>[] = []
      let nodes = await Promise.resolve(this.provider.getChildren())
      this.addHeadLines(lines, highlights)
      let level = 0
      let lnum = lines.length
      for (let node of nodes) {
        let n = await this.appendTreeNode(node, level, lnum, renderedItems, highlights)
        lnum += n
      }
      lines.push(...renderedItems.map(o => o.line))
      this.renderedItems = renderedItems
      this.updateUI(lines, highlights)
      release()
    } catch (e) {
      this.renderedItems = []
      this.nodesMap.clear()
      this.lineState = { titleCount: 0, messageCount: 1 }
      release()
      let errMsg = `${e.message}`.replace(/\r?\n/g, ' ')
      this.updateUI([errMsg], [{ hlGroup: 'ErrorMsg', colStart: 0, colEnd: byteLength(errMsg), lnum: 0 }])
      this.timer = setTimeout(() => {
        void this.render()
      }, 500)
    }
  }

  public async show(splitCommand = 'belowright 30vs'): Promise<void> {
    if (this.bufnr || this._creating) return
    this._creating = true
    let { nvim } = this
    let winid = await nvim.call('coc#util#get_win', ['cocViewId', this.viewId])
    let id = globalId
    globalId = globalId + 1
    nvim.pauseNotification()
    if (winid != -1) {
      let win = nvim.createWindow(winid)
      win.close(true, true)
    }
    nvim.command(`${splitCommand} +setl\\ buftype=nofile CocTreeView${id}`, true)
    nvim.command('setl bufhidden=wipe nonumber norelativenumber foldcolumn=0', true)
    nvim.command(`setl signcolumn=${this.canSelectMany ? 'yes' : 'no'}${this.winfixwidth ? ' winfixwidth' : ''}`, true)
    nvim.command('setl nocursorline nobuflisted wrap undolevels=-1 filetype=coctree nomodifiable noswapfile', true)
    nvim.command(`let w:cocViewId = "${this.viewId.replace(/"/g, '\\"')}"`, true)
    let res = await nvim.resumeNotification()
    if (res[1]) throw new Error(`Error on buffer create:` + JSON.stringify(res[1]))
    const arr = await nvim.eval(`[bufnr('%'),win_getid()]`) as [number, number]
    this._onDidChangeVisibility.fire({ visible: true })
    this.registerKeymaps()
    this.bufnr = arr[0]
    this.winid = arr[1]
    this._creating = false
    void this.render()
  }

  private registerKeymaps(): void {
    let { toggleSelection, close, invoke, toggle, collapseAll } = this.keys
    let { nvim } = this
    const regist = (mode: 'n' | 'v' | 's' | 'x', key: string, fn: (element: T | undefined) => Promise<void>, notify = false) => {
      this.disposables.push(workspace.registerLocalKeymap(mode, key, async () => {
        let lnum = await nvim.call('line', ['.'])
        let element = this.getElementByLnum(lnum - 1)
        if (element && !this.nodesMap.has(element)) return
        await Promise.resolve(fn(element))
      }, notify))
    }
    regist('n', '<LeftRelease>', async element => {
      if (element) await this.onClick(element)
    })
    toggleSelection && regist('n', toggleSelection, async element => {
      if (element) this.toggleSelection(element)
    })
    invoke && regist('n', invoke, async element => {
      if (element) await this.invokeCommand(element)
    }, true)
    toggle && regist('n', toggle, async element => {
      if (element) await this.toggleExpand(element)
    }, true)
    collapseAll && regist('n', collapseAll, async () => {
      for (let obj of this.nodesMap.values()) {
        let item = obj.item
        if (item.collapsibleState == TreeItemCollapsibleState.Expanded) {
          item.collapsibleState = TreeItemCollapsibleState.Collapsed
        }
      }
      await this.render()
    })
    close && regist('n', close, async () => {
      this.hide()
    }, true)
  }

  private hide(): void {
    if (!this.bufnr) return
    this.nvim.command(`bd! ${this.bufnr}`, true)
    if (workspace.isVim) this.nvim.command('redraw', true)
    this._onDidChangeVisibility.fire({ visible: false })
    this.bufnr = undefined
    this.winid = undefined
  }

  private cancelResolve(): void {
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = undefined
    }
  }

  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.hide()
    this.cancelResolve()
    this.tooltipFactory.dispose()
    this.renderedItems = []
    this.nodesMap.clear()
    this.provider = undefined
    disposeAll(this.disposables)
  }
}
