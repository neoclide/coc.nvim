'use strict'
import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { CancellationToken, CancellationTokenSource, Disposable, Emitter, Position, SymbolTag, TypeHierarchyItem } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import commands from '../commands'
import events from '../events'
import languages from '../languages'
import { TreeDataProvider, TreeItem, TreeItemCollapsibleState } from '../tree/index'
import BasicTreeView from '../tree/TreeView'
import { HandlerDelegate, IConfigurationChangeEvent } from '../types'
import { disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { omit } from '../util/lodash'
import window from '../window'
import workspace from '../workspace'
const logger = require('../util/logger')('Handler-typeHierarchy')

interface TypeHierarchyDataItem extends TypeHierarchyItem {
  children?: TypeHierarchyItem[]
}

interface TypeHierarchyConfig {
  splitCommand: string
  openCommand: string
  enableTooltip: boolean
}

type TypeHierarchyKind = 'supertypes' | 'subtypes'

interface TypeHierarchyProvider extends TreeDataProvider<TypeHierarchyDataItem> {
  kind: TypeHierarchyKind
  dispose: () => void
}

export default class TypeHierarchyHandler {
  private config: TypeHierarchyConfig
  private disposables: Disposable[] = []
  public static rangesHighlight = 'CocSelectedRange'
  private highlightWinids: Set<number> = new Set()
  public static commandId = 'typeHierarchy.reveal'
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    events.on('BufWinEnter', (_, winid) => {
      if (this.highlightWinids.has(winid)) {
        this.highlightWinids.delete(winid)
        let win = nvim.createWindow(winid)
        win.clearMatchGroup(TypeHierarchyHandler.rangesHighlight)
      }
    }, null, this.disposables)
    this.disposables.push(commands.registerCommand(TypeHierarchyHandler.commandId, async (winid: number, item: TypeHierarchyDataItem, openCommand?: string) => {
      let { nvim } = this
      await nvim.call('win_gotoid', [winid])
      await workspace.jumpTo(item.uri, item.range.start, openCommand)
      let win = await nvim.window
      win.clearMatchGroup(TypeHierarchyHandler.rangesHighlight)
      win.highlightRanges(TypeHierarchyHandler.rangesHighlight, [item.selectionRange], 10, true)
      this.highlightWinids.add(win.id)
    }, null, true))
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('typeHierarchy')) {
      let c = workspace.getConfiguration('typeHierarchy', null)
      this.config = {
        splitCommand: c.get<string>('splitCommand'),
        openCommand: c.get<string>('openCommand'),
        enableTooltip: c.get<boolean>('enableTooltip')
      }
    }
  }

  private createProvider(rootItems: TypeHierarchyDataItem[], winid: number, kind: TypeHierarchyKind): TypeHierarchyProvider {
    let _onDidChangeTreeData = new Emitter<void | TypeHierarchyDataItem>()
    let source: CancellationTokenSource | undefined
    const cancel = () => {
      if (source) {
        source.cancel()
        source.dispose()
        source = null
      }
    }
    const findParent = (curr: TypeHierarchyDataItem, element: TypeHierarchyDataItem): TypeHierarchyDataItem | undefined => {
      let children = curr.children
      if (!Array.isArray(children)) return undefined
      let find = children.find(o => o == element)
      if (find) return curr
      for (let item of children) {
        let res = findParent(item, element)
        if (res) return res
      }
    }
    let provider: TypeHierarchyProvider = {
      kind,
      onDidChangeTreeData: _onDidChangeTreeData.event,
      getTreeItem: element => {
        let item = new TreeItem(element.name, element.children ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
        if (this.config.enableTooltip) {
          item.tooltip = path.relative(workspace.cwd, URI.parse(element.uri).fsPath)
        }
        item.description = element.detail
        item.deprecated = element.tags?.includes(SymbolTag.Deprecated)
        item.icon = this.handler.getIcon(element.kind)
        item.command = {
          command: TypeHierarchyHandler.commandId,
          title: 'open location',
          arguments: [winid, element, this.config.openCommand]
        }
        return item
      },
      getChildren: async element => {
        cancel()
        source = new CancellationTokenSource()
        let { token } = source
        if (!element) {
          for (let o of rootItems) {
            let children = await this.getChildren(o, provider.kind, token)
            if (token.isCancellationRequested) break
            o.children = children
          }
          return rootItems
        }
        if (element.children) return element.children
        let items = await this.getChildren(element, provider.kind, token)
        source = null
        if (token.isCancellationRequested) return []
        element.children = items
        return items
      },
      resolveActions: () => {
        return [{
          title: 'Open in new tab',
          handler: async element => {
            await commands.executeCommand(TypeHierarchyHandler.commandId, winid, element, 'tabe')
          }
        }, {
          title: 'Show super types',
          handler: element => {
            rootItems = [omit(element, ['children'])]
            provider.kind = 'supertypes'
            _onDidChangeTreeData.fire(undefined)
          }
        }, {
          title: 'Show sub types',
          handler: element => {
            rootItems = [omit(element, ['children'])]
            provider.kind = 'subtypes'
            _onDidChangeTreeData.fire(undefined)
          }
        }, {
          title: 'Dismiss',
          handler: async element => {
            let parentElement: TypeHierarchyDataItem | undefined
            for (let curr of rootItems) {
              parentElement = findParent(curr, element)
              if (parentElement) break
            }
            if (!parentElement) return
            let idx = parentElement.children.findIndex(o => o === element)
            parentElement.children.splice(idx, 1)
            _onDidChangeTreeData.fire(parentElement)
          }
        }]
      },
      dispose: () => {
        cancel()
        _onDidChangeTreeData.dispose()
        rootItems = undefined
      }
    }
    return provider
  }

  private async getChildren(item: TypeHierarchyItem, kind: TypeHierarchyKind, token: CancellationToken): Promise<TypeHierarchyDataItem[]> {
    let res: TypeHierarchyDataItem[] = []
    if (kind == 'supertypes') {
      res = await languages.provideTypeHierarchySupertypes(item, token)
    } else {
      res = await languages.provideTypeHierarchySubtypes(item, token)
    }
    return res
  }

  private async prepare(doc: TextDocument, position: Position): Promise<TypeHierarchyItem[] | undefined> {
    this.handler.checkProvier('typeHierarchy', doc)
    return await this.handler.withRequestToken('typeHierarchy', async token => {
      return await languages.prepareTypeHierarchy(doc, position, token)
    }, false)
  }

  public async showTypeHierarchyTree(kind: TypeHierarchyKind): Promise<void> {
    const { doc, position, winid } = await this.handler.getCurrentState()
    await doc.synchronize()
    const rootItems = await this.prepare(doc.textDocument, position)
    if (isFalsyOrEmpty(rootItems)) {
      void window.showWarningMessage('Unable to get TypeHierarchyItems at cursor position.')
      return
    }
    let provider = this.createProvider(rootItems, winid, kind)
    let treeView = new BasicTreeView('types', { treeDataProvider: provider })
    treeView.title = getTitle(kind)
    provider.onDidChangeTreeData(e => {
      if (!e) treeView.title = getTitle(provider.kind)
    })
    treeView.onDidChangeVisibility(e => {
      if (!e.visible) provider.dispose()
    })
    this.disposables.push(treeView)
    await treeView.show(this.config.splitCommand)
  }

  public dispose(): void {
    this.highlightWinids.clear()
    disposeAll(this.disposables)
  }
}

function getTitle(kind: TypeHierarchyKind): string {
  return kind === 'supertypes' ? 'Super types' : 'Sub types'
}
