import { Neovim } from '@chemzqm/neovim'
import { Disposable, DocumentSymbol, Range, SymbolKind } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import events from '../../events'
import BufferSync from '../../model/bufferSync'
import { TreeItemIcon } from '../../tree'
import BasicDataProvider, { TreeNode } from '../../tree/BasicDataProvider'
import BasicTreeView from '../../tree/TreeView'
import { ConfigurationChangeEvent } from '../../types'
import { disposeAll } from '../../util'
import { getSymbolKind } from '../../util/convert'
import { comparePosition, positionInRange } from '../../util/position'
import workspace from '../../workspace'
import window from '../../window'
import SymbolsBuffer from './buffer'

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
  sortBy: 'position' | 'name' | 'category'
}

/**
 * Manage TreeViews and Providers of outline.
 */
export default class SymbolsOutline {
  private providersMap: Map<number, BasicDataProvider<OutlineNode>> = new Map()
  private treeViews: WeakMap<BasicDataProvider<OutlineNode>, BasicTreeView<OutlineNode>[]> = new WeakMap()
  private config: OutlineConfig
  private disposables: Disposable[] = []
  private labels: { [key: string]: string }
  constructor(
    private nvim: Neovim,
    private buffers: BufferSync<SymbolsBuffer>
  ) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    events.on('BufUnload', bufnr => {
      let provider = this.providersMap.get(bufnr)
      if (provider) {
        this.providersMap.delete(bufnr)
        provider.dispose()
        let views = this.treeViews.get(provider)
        if (views) {
          this.treeViews.delete(provider)
          views.forEach(view => {
            view.dispose()
          })
        }
      }
    }, null, this.disposables)
    events.on('CursorHold', async bufnr => {
      if (!this.config.followCursor) return
      let provider = this.providersMap.get(bufnr)
      if (!provider) return
      let views = this.treeViews.get(provider)
      if (!views || !views.length) return
      let { nvim } = this
      let tabPage = await nvim.tabpage
      let wins = await tabPage.windows
      let ids = wins.map(o => o.id)
      let view = views.find(o => ids.includes(o.windowId))
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
        sortBy: c.get<'position' | 'name' | 'category'>('sortBy'),
      }
    }
  }

  private convertSymbolToNode(documentSymbol: DocumentSymbol, sortFn: (a: OutlineNode, b: OutlineNode) => number): OutlineNode {
    return {
      label: documentSymbol.name,
      tooltip: documentSymbol.detail,
      icon: this.getIcon(documentSymbol.kind),
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
        await nvim.command(`${winnr}wincmd w`)
        let pos = item.selectRange.start
        await nvim.call('coc#util#jumpTo', [pos.line, pos.character])
        await nvim.command(`normal! zt`)
        let buf = nvim.createBuffer(bufnr)
        buf.highlightRanges('outline-hover', 'CocHoverRange', [item.selectRange])
        setTimeout(() => {
          buf.clearNamespace('outline-hover')
        }, 500)
        await nvim.command(`wincmd p`)
        if (workspace.isVim) nvim.command('redraw', true)
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
  public async show(): Promise<void> {
    await workspace.document
    let bufnr = await this.nvim.call('bufnr', ['%'])
    let buf = this.buffers.getItem(bufnr)
    if (!buf) throw new Error('Document not attached')
    let provider = this.providersMap.get(bufnr)
    if (!provider) {
      provider = this.createProvider(buf)
      this.providersMap.set(bufnr, provider)
    }
    let treeView = new BasicTreeView('OUTLINE', {
      treeDataProvider: provider,
    })
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
    if (this.config.keepWindow) {
      await this.nvim.command('wincmd p')
    }
  }

  /**
   * Hide outline of current tab.
   */
  public async hide(): Promise<void> {
    let winid = await this.nvim.call('coc#util#get_win', ['cocViewId', 'OUTLINE'])
    let win = this.nvim.createWindow(winid)
    await win.close(true)
  }

  public dispose(): void {
    for (let provider of this.providersMap.values()) {
      provider.dispose()
    }
    this.providersMap.clear()
    disposeAll(this.disposables)
  }
}
