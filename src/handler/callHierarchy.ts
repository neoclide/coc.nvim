import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, CancellationToken, CancellationTokenSource, Disposable, Emitter, Position, Range, SymbolKind, SymbolTag } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import commands from '../commands'
import languages from '../languages'
import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeItemIcon } from '../tree/index'
import BasicTreeView from '../tree/TreeView'
import { ConfigurationChangeEvent, HandlerDelegate } from '../types'
import { disposeAll } from '../util'
import { getSymbolKind } from '../util/convert'
import workspace from '../workspace'
const logger = require('../util/logger')('Handler-callHierarchy')

interface CallHierarchyDataItem extends CallHierarchyItem {
  ranges?: Range[]
  children?: CallHierarchyItem[]
}

interface CallHierarchyConfig {
  splitCommand: string
  openCommand: string
}

interface CallHierarchyProvider extends TreeDataProvider<CallHierarchyDataItem> {
  kind: 'incoming' | 'outgoing'
  dispose: () => void
}

function isCallHierarchyItem(item: any): item is CallHierarchyItem {
  if (item.name && item.kind && Range.is(item.range) && item.uri) return true
  return false
}

export default class CallHierarchyHandler {
  private config: CallHierarchyConfig
  private labels: { [key: string]: string }
  private disposables: Disposable[] = []
  public static commandId = 'callHierarchy.reveal'
  public static rangesHighlight = 'CocHoverRange'
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    this.disposables.push(commands.registerCommand(CallHierarchyHandler.commandId, async (winid: number, item: CallHierarchyDataItem) => {
      let { nvim } = this
      await nvim.call('win_gotoid', [winid])
      await workspace.jumpTo(item.uri, item.selectionRange.start, this.config.openCommand)
      let win = await nvim.window
      win.highlightRanges('CocHighlightText', [item.selectionRange], 10, true)
      if (item.ranges) {
        win.clearMatchGroup(CallHierarchyHandler.rangesHighlight)
        win.highlightRanges(CallHierarchyHandler.rangesHighlight, item.ranges, 100, true)
      }
    }, null, true))
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('callHierarchy')) {
      this.labels = workspace.getConfiguration('suggest').get<any>('completionItemKindLabels', {})
      let c = workspace.getConfiguration('callHierarchy')
      this.config = {
        splitCommand: c.get<string>('splitCommand'),
        openCommand: c.get<string>('openCommand')
      }
    }
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

  private createProvider(doc: TextDocument, winid: number, position: Position, kind: 'incoming' | 'outgoing'): CallHierarchyProvider {
    let _onDidChangeTreeData = new Emitter<void | CallHierarchyDataItem>()
    let source: CancellationTokenSource | undefined
    let rootItems: CallHierarchyDataItem[] | undefined
    const cancel = () => {
      if (source) {
        source.cancel()
        source.dispose()
        source = null
      }
    }
    let provider: CallHierarchyProvider = {
      kind,
      onDidChangeTreeData: _onDidChangeTreeData.event,
      getTreeItem: element => {
        let item = new TreeItem(element.name, element.children ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
        item.tooltip = path.relative(workspace.cwd, URI.parse(element.uri).fsPath)
        item.description = element.detail
        item.deprecated = element.tags?.includes(SymbolTag.Deprecated)
        item.icon = this.getIcon(element.kind)
        item.command = {
          command: CallHierarchyHandler.commandId,
          title: 'open location',
          arguments: [winid, element]
        }
        return item
      },
      getChildren: async element => {
        cancel()
        source = new CancellationTokenSource()
        if (!element) {
          if (!rootItems) {
            rootItems = await this.prepare(doc, position, source.token) as CallHierarchyDataItem[]
            if (!rootItems || !rootItems.length) {
              throw new Error('No results.')
            }
          }
          for (let o of rootItems) {
            let children = await this.getChildren(doc, o, provider.kind, source.token)
            if (source.token.isCancellationRequested) break
            o.children = children
          }
          return rootItems
        }
        if (element.children) return element.children
        let items = await this.getChildren(doc, element, provider.kind, source.token)
        element.children = items
        return items
      },
      dispose: () => {
        cancel()
        _onDidChangeTreeData.dispose()
      }
    }
    return provider
  }

  private async getChildren(doc: TextDocument, item: CallHierarchyItem, kind: 'incoming' | 'outgoing', token: CancellationToken): Promise<CallHierarchyDataItem[]> {
    let items: CallHierarchyDataItem[] = []
    if (kind == 'incoming') {
      let res = await languages.provideIncomingCalls(doc, item, token)
      if (res) items = res.map(o => Object.assign(o.from, { ranges: o.fromRanges }))
    } else if (kind == 'outgoing') {
      let res = await languages.provideOutgoingCalls(doc, item, token)
      if (res) items = res.map(o => o.to)
    }
    return items
  }

  private async prepare(doc: TextDocument, position: Position, token: CancellationToken): Promise<CallHierarchyItem[]> {
    this.handler.checkProvier('callHierarchy', doc)
    const res = await languages.prepareCallHierarchy(doc, position, token)
    if (!res || token.isCancellationRequested) return undefined
    return isCallHierarchyItem(res) ? [res] : res
  }

  public async getIncoming(item?: CallHierarchyItem): Promise<CallHierarchyIncomingCall[]> {
    const { doc, position } = await this.handler.getCurrentState()
    const source = new CancellationTokenSource()
    if (!item) {
      await doc.synchronize()
      let res = await this.prepare(doc.textDocument, position, source.token)
      item = res ? res[0] : undefined
    }
    if (!isCallHierarchyItem(item)) throw new Error('Not a CallHierarchyItem')
    return await languages.provideIncomingCalls(doc.textDocument, item, source.token)
  }

  public async getOutgoing(item?: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[]> {
    const { doc, position } = await this.handler.getCurrentState()
    const source = new CancellationTokenSource()
    if (!item) {
      await doc.synchronize()
      let res = await this.prepare(doc.textDocument, position, source.token)
      item = res ? res[0] : undefined
    }
    if (!isCallHierarchyItem(item)) throw new Error('Not a CallHierarchyItem')
    return await languages.provideOutgoingCalls(doc.textDocument, item, source.token)
  }

  public async showCallHierarchyTree(kind: 'incoming' | 'outgoing'): Promise<void> {
    const { doc, position, winid } = await this.handler.getCurrentState()
    await doc.synchronize()
    let provider = this.createProvider(doc.textDocument, winid, position, kind)
    let treeView = new BasicTreeView(`${kind.toUpperCase()} CALLS`, {
      treeDataProvider: provider
    })
    provider.onDidChangeTreeData(e => {
      if (!e) treeView.title = `${provider.kind.toUpperCase()} CALLS`
    })
    treeView.onDidChangeVisibility(e => {
      if (!e.visible) {
        provider.dispose()
      }
    })
    await treeView.show(this.config.splitCommand)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
