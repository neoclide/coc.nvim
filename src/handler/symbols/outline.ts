'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CodeActionKind, DocumentSymbol, Position, Range, SymbolKind, SymbolTag } from 'vscode-languageserver-types'
import type { IConfigurationChangeEvent } from '../../configuration/types'
import events from '../../events'
import languages, { ProviderName } from '../../languages'
import BufferSync from '../../model/bufferSync'
import BasicDataProvider, { TreeNode } from '../../tree/BasicDataProvider'
import BasicTreeView from '../../tree/TreeView'
import { disposeAll, getConditionValue } from '../../util'
import { comparePosition, positionInRange } from '../../util/position'
import type { Disposable } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import { HandlerDelegate } from '../types'
import SymbolsBuffer from './buffer'

// Support expand level.
interface OutlineNode extends TreeNode {
  kind: SymbolKind
  range: Range
  selectRange: Range
}

interface OutlineConfig {
  splitCommand: string
  switchSortKey: string
  togglePreviewKey: string
  followCursor: boolean
  keepWindow: boolean
  expandLevel: number
  checkBufferSwitch: boolean
  showLineNumber: boolean
  autoWidth: boolean
  detailAsDescription: boolean
  codeActionKinds: CodeActionKind[]
  sortBy: 'position' | 'name' | 'category'
  autoPreview: boolean
  previewMaxWidth: number
  previewBorder: boolean
  previewBorderRounded: boolean
  previewHighlightGroup: string
  previewBorderHighlightGroup: string
  previewWinblend: number
}

const hoverTimeout = getConditionValue(300, 10)

/**
 * Manage TreeViews and Providers of outline.
 */
export default class SymbolsOutline {
  private treeViewList: BasicTreeView<OutlineNode>[] = []
  private providersMap: Map<number, BasicDataProvider<OutlineNode>> = new Map()
  private sortByMap: Map<number, string> = new Map()
  private config: OutlineConfig
  private disposables: Disposable[] = []
  constructor(
    private nvim: Neovim,
    private buffers: BufferSync<SymbolsBuffer>,
    private handler: HandlerDelegate
  ) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    workspace.onDidCloseTextDocument(async e => {
      let { bufnr } = e
      let provider = this.providersMap.get(bufnr)
      if (!provider) return
      let loaded = await nvim.call('bufloaded', [bufnr]) as number
      // reload detected
      if (loaded) return
      this.providersMap.delete(bufnr)
      provider.dispose()
    }, null, this.disposables)
    window.onDidChangeActiveTextEditor(async editor => {
      if (!this.config.checkBufferSwitch) return
      let view = this.treeViewList.find(v => v.visible && v.targetTabId == editor.tabpageid)
      if (view) {
        await this.showOutline(editor.document.bufnr, editor.tabpageid)
        await nvim.command(`noa call win_gotoid(${editor.winid})`)
      }
    }, null, this.disposables)
    events.on('CursorHold', async (bufnr: number, cursor: [number, number]) => {
      if (!this.config.followCursor) return
      let provider = this.providersMap.get(bufnr)
      if (!provider) return
      let tabpage = await nvim.tabpage
      let view = this.treeViewList.find(o => o.visible && o.targetBufnr == bufnr && o.targetTabId == tabpage.id)
      if (!view) return
      await this.revealPosition(bufnr, view, Position.create(cursor[0] - 1, cursor[1] - 1))
    }, null, this.disposables)
  }

  private async revealPosition(bufnr: number, treeView: BasicTreeView<OutlineNode>, position: Position): Promise<void> {
    let provider = this.providersMap.get(bufnr)
    let nodes = await Promise.resolve(provider.getChildren())
    let curr = getNodeByPosition(position, nodes)
    if (curr) await treeView.reveal(curr)
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('outline')) {
      let c = workspace.getConfiguration('outline', null)
      this.config = {
        splitCommand: c.get<string>('splitCommand'),
        switchSortKey: c.get<string>('switchSortKey'),
        togglePreviewKey: c.get<string>('togglePreviewKey'),
        followCursor: c.get<boolean>('followCursor'),
        keepWindow: c.get<boolean>('keepWindow'),
        expandLevel: c.get<number>('expandLevel'),
        autoWidth: c.get<boolean>('autoWidth'),
        checkBufferSwitch: c.get<boolean>('checkBufferSwitch'),
        detailAsDescription: c.get<boolean>('detailAsDescription'),
        sortBy: c.get<'position' | 'name' | 'category'>('sortBy'),
        showLineNumber: c.get<boolean>('showLineNumber'),
        codeActionKinds: c.get<string[]>('codeActionKinds'),
        autoPreview: c.get<boolean>('autoPreview'),
        previewMaxWidth: c.get<number>('previewMaxWidth'),
        previewBorder: c.get<boolean>('previewBorder'),
        previewBorderRounded: c.get<boolean>('previewBorderRounded'),
        previewHighlightGroup: c.get<string>('previewHighlightGroup'),
        previewBorderHighlightGroup: c.get<string>('previewBorderHighlightGroup'),
        previewWinblend: c.get<number>('previewWinblend'),
      }
    }
  }

  private convertSymbolToNode(documentSymbol: DocumentSymbol, sortFn: (a: OutlineNode, b: OutlineNode) => number): OutlineNode {
    let descs = []
    let { detailAsDescription, showLineNumber } = this.config
    if (detailAsDescription && documentSymbol.detail) descs.push(documentSymbol.detail)
    if (showLineNumber) descs.push(`${documentSymbol.selectionRange.start.line + 1}`)
    return {
      label: documentSymbol.name,
      tooltip: detailAsDescription ? undefined : documentSymbol.detail,
      description: descs.join(' '),
      icon: this.handler.getIcon(documentSymbol.kind),
      deprecated: documentSymbol.tags?.includes(SymbolTag.Deprecated),
      kind: documentSymbol.kind,
      range: documentSymbol.range,
      selectRange: documentSymbol.selectionRange,
      children: Array.isArray(documentSymbol.children) ? documentSymbol.children.map(o => {
        return this.convertSymbolToNode(o, sortFn)
      }).sort(sortFn) : undefined
    }
  }

  private setMessage(bufnr: number, msg: string | undefined): void {
    this.treeViewList.forEach(v => {
      if (v.valid && v.targetBufnr == bufnr) {
        v.message = msg
      }
    })
  }

  private convertSymbols(bufnr: number, symbols: DocumentSymbol[]): OutlineNode[] {
    let sortBy = this.getSortBy(bufnr)
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
    return symbols.map(s => this.convertSymbolToNode(s, sortFn)).sort(sortFn)
  }

  public onSymbolsUpdate(bufnr: number, symbols: DocumentSymbol[]): void {
    let provider = this.providersMap.get(bufnr)
    if (provider) provider.update(this.convertSymbols(bufnr, symbols))
  }

  private createProvider(bufnr: number): BasicDataProvider<OutlineNode> {
    let { nvim } = this
    let provider = new BasicDataProvider({
      expandLevel: this.config.expandLevel,
      provideData: async () => {
        let buf = this.buffers.getItem(bufnr)
        if (!buf) throw new Error('Document not attached')
        let doc = workspace.getDocument(bufnr)
        if (!languages.hasProvider(ProviderName.DocumentSymbol, doc.textDocument)) {
          throw new Error('Document symbol provider not found')
        }
        let meta = languages.getDocumentSymbolMetadata(doc.textDocument)
        if (meta && meta.label) {
          let views = this.treeViewList.filter(v => v.valid && v.targetBufnr == bufnr)
          views.forEach(view => view.description = meta.label)
        }
        this.setMessage(bufnr, 'Loading document symbols')
        let arr = await buf.getSymbols()
        if (!arr || arr.length == 0) {
          // server may return empty symbols on buffer initialize, throw error to force reload.
          throw new Error('Empty symbols returned from language server. ')
        }
        this.setMessage(bufnr, undefined)
        return this.convertSymbols(bufnr, arr)
      },
      handleClick: async item => {
        let winnr = await nvim.call('bufwinnr', [bufnr])
        if (winnr == -1) return
        nvim.pauseNotification()
        nvim.command(`${winnr}wincmd w`, true)
        let pos = item.selectRange.start
        nvim.call('coc#cursor#move_to', [pos.line, pos.character], true)
        nvim.command(`normal! zz`, true)
        let buf = nvim.createBuffer(bufnr)
        buf.highlightRanges('outline-hover', 'CocHoverRange', [item.selectRange])
        nvim.command('redraw', true)
        await nvim.resumeNotification()
        setTimeout(() => {
          buf.clearNamespace('outline-hover')
          nvim.command('redraw', true)
        }, hoverTimeout)
      },
      resolveActions: async (_, element) => {
        let winnr = await nvim.call('bufwinnr', [bufnr])
        if (winnr == -1) return
        let doc = workspace.getDocument(bufnr)
        let actions = await this.handler.getCodeActions(doc, element.range, this.config.codeActionKinds)
        let arr = actions.map(o => {
          return {
            title: o.title,
            handler: async () => {
              let position = element.range.start
              await nvim.command(`${winnr}wincmd w`)
              await this.nvim.call('coc#cursor#move_to', [position.line, position.character])
              await this.handler.applyCodeAction(o)
            }
          }
        })
        return [...arr, {
          title: 'Visual Select',
          handler: async item => {
            await nvim.command(`${winnr}wincmd w`)
            await window.selectRange(item.range)
          }
        }]
      },
      onDispose: () => {
        for (let view of this.treeViewList.slice()) {
          if (view.provider === provider) {
            view.dispose()
          }
        }
      }
    })
    return provider
  }

  private getSortBy(bufnr: number): string {
    return this.sortByMap.get(bufnr) ?? this.config.sortBy
  }

  private async showOutline(bufnr: number, tabId: number): Promise<BasicTreeView<OutlineNode>> {
    if (!this.providersMap.has(bufnr)) {
      this.providersMap.set(bufnr, this.createProvider(bufnr))
    }
    let treeView = this.treeViewList.find(v => v.valid && v.targetBufnr == bufnr && v.targetTabId == tabId)
    if (!treeView) {
      let { switchSortKey, togglePreviewKey } = this.config
      let autoPreview = this.config.autoPreview
      let previewBufnr: number | undefined
      treeView = new BasicTreeView('OUTLINE', {
        autoWidth: this.config.autoWidth,
        bufhidden: 'hide',
        enableFilter: true,
        treeDataProvider: this.providersMap.get(bufnr),
      })
      let sortBy = this.getSortBy(bufnr)
      let prev: OutlineNode | undefined
      treeView.description = `${sortBy[0].toUpperCase()}${sortBy.slice(1)}`
      this.treeViewList.push(treeView)
      let disposable = events.on('BufEnter', bufnr => {
        if (previewBufnr && bufnr !== previewBufnr) {
          prev = undefined
          this.closePreview()
        }
      })
      treeView.onDispose(() => {
        let idx = this.treeViewList.findIndex(v => v === treeView)
        if (idx !== -1) this.treeViewList.splice(idx, 1)
        disposable.dispose()
        this.closePreview()
      })
      treeView.onDidCursorMoved(async node => {
        if (autoPreview && prev !== node) {
          prev = node
          previewBufnr = await this.doPreview(bufnr, node)
        }
      })
      treeView.registerLocalKeymap('n', switchSortKey, async () => {
        let arr = ['category', 'name', 'position']
        let curr = this.getSortBy(bufnr)
        let items = arr.map(s => {
          return { text: s, disabled: s === curr }
        })
        let res = await window.showMenuPicker(items, { title: 'Choose sort method' })
        if (res < 0) return
        let sortBy = arr[res]
        this.sortByMap.set(bufnr, sortBy)
        let views = this.treeViewList.filter(o => o.targetBufnr == bufnr)
        views.forEach(view => {
          view.description = `${sortBy[0].toUpperCase()}${sortBy.slice(1)}`
        })
        let item = this.buffers.getItem(bufnr)
        this.onSymbolsUpdate(bufnr, item.symbols)
      }, true)
      treeView.registerLocalKeymap('n', togglePreviewKey, async node => {
        autoPreview = !autoPreview
        if (!autoPreview) {
          prev = undefined
          this.closePreview()
        } else {
          previewBufnr = await this.doPreview(bufnr, node)
        }
      }, true)
    }
    await treeView.show(this.config.splitCommand, false)
    return treeView
  }

  public async doPreview(bufnr: number, node: OutlineNode | undefined): Promise<undefined | number> {
    if (!node) {
      this.closePreview()
      return
    }
    let config: any = {
      bufnr,
      range: node.range,
      border: this.config.previewBorder,
      rounded: this.config.previewBorderRounded,
      maxWidth: this.config.previewMaxWidth,
      highlight: this.config.previewHighlightGroup,
      borderhighlight: this.config.previewBorderHighlightGroup,
      winblend: this.config.previewWinblend
    }
    return await this.nvim.call('coc#ui#outline_preview', [config]) as number
  }

  private closePreview(): void {
    this.nvim.call('coc#ui#outline_close_preview', [], true)
  }

  /**
   * Create outline view.
   */
  public async show(keep?: number): Promise<void> {
    let [bufnr, winid] = await this.nvim.eval('[bufnr("%"),win_getid()]') as [number, number]
    let tabpage = await this.nvim.tabpage
    let doc = workspace.getDocument(bufnr)
    if (doc && !doc.attached) {
      void window.showErrorMessage(`Unable to show outline, ${doc.notAttachReason}`)
      return
    }
    let position = await window.getCursorPosition()
    let treeView = await this.showOutline(bufnr, tabpage.id)
    if (keep == 1 || (keep === undefined && this.config.keepWindow)) {
      await this.nvim.command(`noa call win_gotoid(${winid})`)
    } else if (this.config.followCursor) {
      let disposable = treeView.onDidRefrash(async () => {
        disposable.dispose()
        let curr = await this.nvim.eval('bufnr("%")')
        if (curr == bufnr && treeView.visible) {
          await this.revealPosition(bufnr, treeView, position)
        }
      })
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
    for (let view of this.treeViewList) {
      view.dispose()
    }
    this.treeViewList = []
    for (let provider of this.providersMap.values()) {
      provider.dispose()
    }
    this.providersMap.clear()
    disposeAll(this.disposables)
  }
}

function getNodeByPosition(position: Position, nodes: ReadonlyArray<OutlineNode>): OutlineNode | undefined {
  let curr: OutlineNode | undefined
  let checkNodes = (nodes: ReadonlyArray<OutlineNode>): void => {
    for (let node of nodes) {
      if (positionInRange(position, node.range) == 0) {
        curr = node
        if (Array.isArray(node.children)) {
          checkNodes(node.children)
        }
        break
      }
    }
  }
  checkNodes(nodes)
  return curr
}
