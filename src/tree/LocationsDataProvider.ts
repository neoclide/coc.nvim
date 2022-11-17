import { Range, SymbolKind, SymbolTag } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import { path } from '../util/node'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../util/protocol'
import workspace from '../workspace'
import { TreeDataProvider, TreeItemAction } from './index'
import { TreeItem, TreeItemCollapsibleState } from './TreeItem'

export interface LocationDataItem<T> {
  name: string
  kind: SymbolKind
  tags?: SymbolTag[]
  detail?: string
  uri: string
  range?: Range
  selectionRange?: Range
  parent?: T
  children?: T[]
}

interface ProviderConfig {
  readonly openCommand: string
  readonly enableTooltip: boolean
}

export default class LocationsDataProvider<T extends LocationDataItem<T>, P> implements TreeDataProvider<T>{
  private readonly _onDidChangeTreeData = new Emitter<T | undefined>()
  public readonly onDidChangeTreeData: Event<T | undefined> = this._onDidChangeTreeData.event
  private tokenSource: CancellationTokenSource
  private actions: TreeItemAction<T>[] = []
  public static rangesHighlight = 'CocSelectedRange'
  constructor(
    public meta: P,
    private winid: number,
    private config: ProviderConfig,
    private commandId: string,
    private rootItems: ReadonlyArray<T>,
    private getIcon: (kind: SymbolKind) => { text: string, hlGroup: string },
    private resolveChildren: (el: T, meta: P, token: CancellationToken) => Promise<T[]>
  ) {
    this.addAction('Open in new tab', async element => {
      await commands.executeCommand(this.commandId, winid, element, 'tabe')
    })
    this.addAction('Dismiss', async element => {
      if (element.parent == null) {
        let els = this.rootItems.filter(o => o !== element)
        this.reset(els)
      } else {
        let parentElement = element.parent
        let idx = parentElement.children.findIndex(o => o === element)
        parentElement.children.splice(idx, 1)
        this._onDidChangeTreeData.fire(parentElement)
      }
    })
  }

  protected cancel() {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = undefined
    }
  }

  public reset(rootItems: T[]): void {
    this.rootItems = rootItems
    this._onDidChangeTreeData.fire(undefined)
  }

  public addAction(title: string, handler: (element: T) => void): void {
    this.actions.push({ title, handler })
  }

  public async getChildren(element?: T): Promise<ReadonlyArray<T>> {
    this.cancel()
    this.tokenSource = new CancellationTokenSource()
    let { token } = this.tokenSource
    if (!element) {
      for (let o of this.rootItems) {
        let children = await this.resolveChildren(o, this.meta, token)
        addChildren(o, children, token)
      }
      return this.rootItems
    }
    if (element.children) return element.children
    let items = await this.resolveChildren(element, this.meta, token)
    this.tokenSource = undefined
    addChildren(element, items, token)
    return items
  }

  public getTreeItem(element: T): TreeItem {
    let item = new TreeItem(element.name, element.children ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed)
    if (this.config.enableTooltip) {
      item.tooltip = path.relative(workspace.cwd, URI.parse(element.uri).fsPath)
    }
    item.description = element.detail
    item.deprecated = element.tags?.includes(SymbolTag.Deprecated)
    item.icon = this.getIcon(element.kind)
    item.command = {
      command: this.commandId,
      title: 'open location',
      arguments: [this.winid, element, this.config.openCommand]
    }
    return item
  }

  public resolveActions(): TreeItemAction<T>[] {
    return this.actions
  }

  public dispose(): void {
    this.cancel()
    let win = workspace.nvim.createWindow(this.winid)
    win.clearMatchGroup(LocationsDataProvider.rangesHighlight)
  }
}

export function addChildren<T extends LocationDataItem<T>>(el: T, children: T[] | undefined, token?: CancellationToken): void {
  if (!Array.isArray(children) || (token && token.isCancellationRequested)) return
  children.forEach(item => item.parent = el)
  el.children = children
}
