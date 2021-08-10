import { Neovim } from '@chemzqm/neovim'
import { CallHierarchyIncomingCall, Position, Range, CallHierarchyItem, CallHierarchyOutgoingCall, CancellationTokenSource, SymbolKind, SymbolTag, Location, Disposable, CancellationToken } from 'vscode-languageserver-protocol'
import languages from '../languages'
import workspace from '../workspace'
import { ConfigurationChangeEvent, HandlerDelegate } from '../types'
import BasicTreeView from '../tree/TreeView'
import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, TreeItemIcon } from '../tree/index'
import { getSymbolKind } from '../util/convert'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { disposeAll } from '../util'
const logger = require('../util/logger')('Handler-callHierarchy')

interface CallHierarchyDataItem extends CallHierarchyItem {
  fromRanges?: Range[]
  children?: CallHierarchyItem[]
}

interface CallHierarchyConfig {
  splitCommand: string
  openCommand: string
}

function isCallHierarchyItem(item: any): item is CallHierarchyItem {
  if (item.name && item.kind && Range.is(item.range) && item.uri) return true
  return false
}

export default class CallHierarchyHandler {
  private config: CallHierarchyConfig
  private labels: { [key: string]: string }
  private disposables: Disposable[] = []
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
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

  private createProvider(doc: TextDocument, winid: number, position: Position, kind: 'incoming' | 'outgoing'): TreeDataProvider<CallHierarchyDataItem> {
    return {
      getTreeItem: element => {
        let item = new TreeItem(element.name, element.children ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
        item.tooltip = element.detail
        item.deprecated = element.tags?.includes(SymbolTag.Deprecated)
        item.icon = this.getIcon(element.kind)
        item.command = {
          command: 'workspace.openLocation',
          title: 'open location',
          arguments: [winid, Location.create(element.uri, element.selectionRange), this.config.openCommand]
        }
        return item
      },
      getChildren: async element => {
        const source = new CancellationTokenSource()
        if (!element) {
          let items = await this.prepare(doc, position, source.token) as CallHierarchyDataItem[]
          if (!items || !items.length) {
            throw new Error('No results.')
          }
          for (let o of items) {
            let children = await this.getChildren(doc, o, kind, source.token)
            if (source.token.isCancellationRequested) break
            o.children = children
          }
          return items
        }
        if (element.children) return element.children
        let items = await this.getChildren(doc, element, kind, source.token)
        element.children = items
        return items
      }
    }
  }

  private async getChildren(doc: TextDocument, item: CallHierarchyItem, kind: 'incoming' | 'outgoing', token: CancellationToken): Promise<CallHierarchyDataItem[]> {
    let items: CallHierarchyDataItem[] = []
    if (kind == 'incoming') {
      let res = await languages.provideIncomingCalls(doc, item, token)
      if (res) items = res.map(o => Object.assign(o.from, o.fromRanges))
    } else if (kind == 'outgoing') {
      let res = await languages.provideOutgoingCalls(doc, item, token)
      if (res) items = res.map(o => Object.assign(o.to, o.fromRanges))
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
    await treeView.show(this.config.splitCommand)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
