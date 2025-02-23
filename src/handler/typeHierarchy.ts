'use strict'
import { Neovim } from '@chemzqm/neovim'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, TypeHierarchyItem } from 'vscode-languageserver-types'
import commands from '../commands'
import type { IConfigurationChangeEvent } from '../configuration/types'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { TreeDataProvider } from '../tree/index'
import LocationsDataProvider from '../tree/LocationsDataProvider'
import BasicTreeView from '../tree/TreeView'
import { disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { omit } from '../util/lodash'
import { CancellationToken, Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'

interface TypeHierarchyDataItem extends TypeHierarchyItem {
  parent?: TypeHierarchyDataItem
  children?: TypeHierarchyItem[]
}

interface TypeHierarchyConfig {
  splitCommand: string
  openCommand: string
  enableTooltip: boolean
}

type TypeHierarchyKind = 'supertypes' | 'subtypes'

interface TypeHierarchyProvider extends TreeDataProvider<TypeHierarchyDataItem> {
  meta: TypeHierarchyKind
  dispose: () => void
}

/**
 * Cleanup properties used by treeview
 */
function toTypeHierarchyItem(item: TypeHierarchyDataItem): TypeHierarchyItem {
  return omit(item, ['children', 'parent'])
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
    let provider = new LocationsDataProvider<TypeHierarchyDataItem, TypeHierarchyKind>(
      kind,
      winid,
      this.config,
      TypeHierarchyHandler.commandId,
      rootItems,
      kind => this.handler.getIcon(kind),
      (el, meta, token) => this.getChildren(el, meta, token)
    )
    provider.addAction(`Show Super Types`, (el: TypeHierarchyDataItem) => {
      provider.meta = 'supertypes'
      let rootItems = [omit(el, ['children', 'parent'])]
      provider.reset(rootItems)
    })
    provider.addAction(`Show Sub Types`, (el: TypeHierarchyDataItem) => {
      provider.meta = 'subtypes'
      let rootItems = [omit(el, ['children', 'parent'])]
      provider.reset(rootItems)
    })
    return provider
  }

  private async getChildren(item: TypeHierarchyDataItem, kind: TypeHierarchyKind, token: CancellationToken): Promise<TypeHierarchyDataItem[]> {
    let res: TypeHierarchyDataItem[] = []
    let typeHierarchyItem = toTypeHierarchyItem(item)
    if (kind == 'supertypes') {
      res = await languages.provideTypeHierarchySupertypes(typeHierarchyItem, token)
    } else {
      res = await languages.provideTypeHierarchySubtypes(typeHierarchyItem, token)
    }
    return res
  }

  private async prepare(doc: TextDocument, position: Position): Promise<TypeHierarchyItem[] | undefined> {
    this.handler.checkProvider(ProviderName.TypeHierarchy, doc)
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
      if (!e) treeView.title = getTitle(provider.meta)
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
