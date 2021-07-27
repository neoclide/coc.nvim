import { Neovim } from '@chemzqm/neovim'
import { Disposable, DocumentSymbol, Range, SymbolKind, SymbolTag } from 'vscode-languageserver-protocol'
import events from '../../events'
import debounce from 'debounce'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import { TreeItemIcon } from '../../tree'
import BasicDataProvider, { TreeNode } from '../../tree/BasicDataProvider'
import BasicTreeView from '../../tree/TreeView'
import { ConfigurationChangeEvent } from '../../types'
import { disposeAll } from '../../util'
import { getSymbolKind } from '../../util/convert'
import { comparePosition, positionInRange } from '../../util/position'
import window from '../../window'
import workspace from '../../workspace'
import SymbolsBuffer from './buffer'
const logger = require('../../util/logger')('symbols-outline')

// Support expand level.
interface OutlineNode extends TreeNode {
  kind: SymbolKind
  range: Range
  selectRange: Range
}

interface OutlineConfig {
  splitCommand: string
  followCursor: boolean
  keepWindow: boolean
  expandLevel: number
  checkBufferSwitch: boolean
  sortBy: 'position' | 'name' | 'category'
}

/**
 * Manage TreeViews and Providers of outline.
 */
export default class SymbolsOutline {
  private providersMap: Map<number, BasicDataProvider<OutlineNode>> = new Map()
  private treeViews: WeakMap<BasicDataProvider<OutlineNode>, BasicTreeView<OutlineNode>[]> = new WeakMap()
  private originalWins: WeakMap<BasicTreeView<OutlineNode>, number> = new WeakMap()
  private config: OutlineConfig
  private disposables: Disposable[] = []
  private labels: { [key: string]: string }
  constructor(
    private nvim: Neovim,
    private buffers: BufferSync<SymbolsBuffer>
  ) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    events.on('BufUnload', async bufnr => {
      let provider = this.providersMap.get(bufnr)
      if (provider) {
        this.providersMap.delete(bufnr)
        provider.dispose()
        let views = this.treeViews.get(provider)
        this.treeViews.delete(provider)
        for (let view of views) {
          if (!view.visible) continue
          let winid = this.originalWins.get(view)
          if (winid && this.config.checkBufferSwitch) {
            // check if original window exists
            let nr = await nvim.call('win_id2win', [winid])
            if (nr) {
              let win = nvim.createWindow(view.windowId)
              // buffer could be recreated.
              win.setVar('target_bufnr', -1, true)
              let timer = setTimeout(() => {
                if (view.visible) view.dispose()
              }, 200)
              this.disposables.push({
                dispose: () => {
                  clearTimeout(timer)
                }
              })
              continue
            }
          }
          this.originalWins.delete(view)
          view.dispose()
        }
      }
    }, null, this.disposables)
    events.on('BufEnter', debounce(bufnr => {
      this._onBufEnter(bufnr).logError()
    }, global.hasOwnProperty('__TEST__') ? 10 : 100), null, this.disposables)
    events.on('CursorHold', async bufnr => {
      if (!this.config.followCursor) return
      let provider = this.providersMap.get(bufnr)
      if (!provider) return
      let views = this.treeViews.get(provider)
      if (!views || !views.length) return
      let winid = await this.nvim.call('coc#window#find', ['cocViewId', 'OUTLINE'])
      if (winid == -1) return
      let view = views.find(o => o.windowId == winid)
      if (!view) return
      let pos = await window.getCursorPosition()
      let curr: OutlineNode
      let checkNode = (node: OutlineNode): boolean => {
        if (positionInRange(pos, node.range) != 0) return false
        curr = node
        if (Array.isArray(node.children)) {
          for (let n of node.children) {
            if (checkNode(n)) break
          }
        }
        return true
      }
      let nodes = await Promise.resolve(provider.getChildren())
      for (let n of nodes) {
        if (checkNode(n)) break
      }
      if (curr) await view.reveal(curr)
    }, null, this.disposables)
  }

  private async _onBufEnter(bufnr: number): Promise<void> {
    if (!this.config.checkBufferSwitch) return
    let winid = await this.nvim.call('coc#window#find', ['cocViewId', 'OUTLINE'])
    if (winid == -1) return
    if (!this.buffers.getItem(bufnr)) {
      let doc = await workspace.document
      if (doc.bufnr != bufnr || !this.buffers.getItem(bufnr)) return
    }
    let win = this.nvim.createWindow(winid)
    let target = await win.getVar('target_bufnr')
    if (target == bufnr) return
    await this.show(1)
  }

  private getIcon(kind: SymbolKind): TreeItemIcon {
    let { labels } = this
    let kindText = getSymbolKind(kind)
    let defaultIcon = typeof labels['default'] === 'string' ? labels['default'] : kindText[0].toLowerCase()
    let text = kindText == 'Unknown' ? '' : labels[kindText[0].toLowerCase() + kindText.slice(1)]
    if (!text || typeof text !== 'string') text = defaultIcon
    return {
      text,
      hlGroup: kindText == 'Unknown' ? 'CocSymbolDefault' : `CocSymbol${kindText}`
    }
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('outline')) {
      this.labels = workspace.getConfiguration('suggest').get<any>('completionItemKindLabels', {})
      let c = workspace.getConfiguration('outline')
      this.config = {
        splitCommand: c.get<string>('splitCommand'),
        followCursor: c.get<boolean>('followCursor'),
        keepWindow: c.get<boolean>('keepWindow'),
        expandLevel: c.get<number>('expandLevel'),
        checkBufferSwitch: c.get<boolean>('checkBufferSwitch'),
        sortBy: c.get<'position' | 'name' | 'category'>('sortBy'),
      }
    }
  }

  private convertSymbolToNode(documentSymbol: DocumentSymbol, sortFn: (a: OutlineNode, b: OutlineNode) => number): OutlineNode {
    // let lnum = documentSymbol.selectionRange.start.line + 1
    return {
      label: documentSymbol.name,
      tooltip: documentSymbol.detail,
      icon: this.getIcon(documentSymbol.kind),
      deprecated: documentSymbol.tags?.includes(SymbolTag.Deprecated),
      kind: documentSymbol.kind,
      range: documentSymbol.range,
      selectRange: documentSymbol.selectionRange,
      children: Array.isArray(documentSymbol.children) ? documentSymbol.children.map(o => {
        return this.convertSymbolToNode(o, sortFn)
      }).sort(sortFn) : undefined
    }
  }

  private setMessage(provider: BasicDataProvider<OutlineNode>, msg: string | undefined): void {
    let views = this.treeViews.get(provider)
    if (views) {
      views.forEach(view => {
        view.message = msg
      })
    }
  }

  private createProvider(buf: SymbolsBuffer): BasicDataProvider<OutlineNode> {
    let { bufnr } = buf
    let { sortBy } = this.config
    let sortFn = (a: OutlineNode, b: OutlineNode): number => {
      if (sortBy === 'name') {
        return a.label < b.label ? -1 : 1
      }
      if (sortBy === 'category') {
        if (a.kind == b.kind) return a.label < b.label ? -1 : 1
        return a.kind - b.kind
      }
      return comparePosition(a.selectRange.start, b.selectRange.start)
    }
    let convertSymbols = (symbols: DocumentSymbol[]): OutlineNode[] => {
      return symbols.map(s => this.convertSymbolToNode(s, sortFn)).sort(sortFn)
    }
    let disposable: Disposable
    let provider = new BasicDataProvider({
      expandLevel: this.config.expandLevel,
      provideData: async () => {
        let doc = workspace.getDocument(buf.bufnr)
        if (!languages.hasProvider('documentSymbol', doc.textDocument)) {
          throw new Error('Document symbol provider not found')
        }
        this.setMessage(provider, 'Loading document symbols')
        let arr = await buf.getSymbols()
        if (!arr || arr.length == 0) {
          // server may return empty symbols on buffer initialize, throw error to force reload.
          throw new Error('Empty symbols returned from language server. ')
        }
        disposable = buf.onDidUpdate(symbols => {
          provider.update(convertSymbols(symbols))
        })
        this.setMessage(provider, undefined)
        return convertSymbols(arr)
      },
      handleClick: async item => {
        let { nvim } = this
        let winnr = await nvim.call('bufwinnr', [bufnr])
        if (winnr == -1) return
        nvim.pauseNotification()
        nvim.command(`${winnr}wincmd w`, true)
        let pos = item.selectRange.start
        nvim.call('coc#util#jumpTo', [pos.line, pos.character], true)
        nvim.command(`normal! zz`, true)
        let buf = nvim.createBuffer(bufnr)
        buf.highlightRanges('outline-hover', 'CocHoverRange', [item.selectRange])
        nvim.command('redraw', true)
        await nvim.resumeNotification()
        setTimeout(() => {
          buf.clearNamespace('outline-hover')
          nvim.command('redraw', true)
        }, global.hasOwnProperty('__TEST__') ? 10 : 300)
      },
      onDispose: () => {
        this.providersMap.delete(buf.bufnr)
        if (disposable) disposable.dispose()
      }
    })
    return provider
  }

  /**
   * Create outline view.
   */
    public async show(keep?: number): Promise<void> {
      await workspace.document
      let [bufnr, winid] = await this.nvim.eval('[bufnr("%"),win_getid()]') as [number, number]
      let buf = this.buffers.getItem(bufnr)
      if (!buf) throw new Error('Document not attached')
      let provider = this.providersMap.get(bufnr)
      if (!provider) {
        provider = this.createProvider(buf)
        this.providersMap.set(bufnr, provider)
      }
      let treeView = new BasicTreeView('OUTLINE', {
        enableFilter: true,
        treeDataProvider: provider,
      })
      this.originalWins.set(treeView, winid)
      let arr = this.treeViews.get(provider) || []
      arr.push(treeView)
      this.treeViews.set(provider, arr)
      treeView.onDidChangeVisibility(({ visible }) => {
        if (visible || !this.treeViews.has(provider)) return
        let arr = this.treeViews.get(provider) || []
        arr = arr.filter(s => s !== treeView)
        if (arr.length) {
          this.treeViews.set(provider, arr)
          return
        }
        provider.dispose()
        this.treeViews.delete(provider)
      })
      await treeView.show(this.config.splitCommand)
      if (treeView.windowId) {
        let win = this.nvim.createWindow(treeView.windowId)
        win.setVar('target_bufnr', bufnr, true)
      }
      if (keep == 1 || (keep === undefined && this.config.keepWindow)) {
        await this.nvim.command('wincmd p')
      }
    }

  public has(bufnr: number): boolean {
    return this.providersMap.has(bufnr)
  }

  /**
   * Hide outline of current tab.
   */
  public async hide(): Promise<void> {
    let winid = await this.nvim.call('coc#window#find', ['cocViewId', 'OUTLINE']) as number
    if (winid == -1) return
    await this.nvim.call('coc#window#close', [winid])
  }

  public dispose(): void {
    for (let provider of this.providersMap.values()) {
      provider.dispose()
      for (let view of this.treeViews.get(provider)) {
        view.dispose()
      }
    }
    this.providersMap.clear()
    disposeAll(this.disposables)
  }
}
