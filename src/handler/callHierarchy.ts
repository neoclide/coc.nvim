'use strict'
import { Neovim } from '@chemzqm/neovim'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Position, Range } from 'vscode-languageserver-types'
import commands from '../commands'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { TreeDataProvider } from '../tree/index'
import LocationsDataProvider from '../tree/LocationsDataProvider'
import BasicTreeView from '../tree/TreeView'
import { IConfigurationChangeEvent } from '../types'
import { disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { omit } from '../util/lodash'
import { CancellationToken, CancellationTokenSource, Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'

interface CallHierarchyDataItem extends CallHierarchyItem {
  parent?: CallHierarchyDataItem
  ranges?: Range[]
  sourceUri?: string
  children?: CallHierarchyItem[]
}

interface CallHierarchyConfig {
  splitCommand: string
  openCommand: string
  enableTooltip: boolean
}

enum ShowHierarchyAction {
  Incoming = 'Show Incoming Calls',
  Outgoing = 'Show Outgoing Calls'
}

interface CallHierarchyProvider extends TreeDataProvider<CallHierarchyDataItem> {
  meta: 'incoming' | 'outgoing'
  dispose: () => void
}

/**
 * Cleanup properties used by treeview
 */
function toCallHierarchyItem(item: CallHierarchyDataItem): CallHierarchyItem {
  return omit(item, ['children', 'parent', 'ranges', 'sourceUri'])
}

function isCallHierarchyItem(item: any): item is CallHierarchyItem {
  if (item && typeof item.name === 'string' && item.kind && Range.is(item.range)) return true
  return false
}

const HIGHLIGHT_GROUP = 'CocSelectedRange'

export default class CallHierarchyHandler {
  private config: CallHierarchyConfig
  private disposables: Disposable[] = []
  public static commandId = 'callHierarchy.reveal'
  private highlightWinids: Set<number> = new Set()
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    this.disposables.push(commands.registerCommand(CallHierarchyHandler.commandId, async (winid: number, item: CallHierarchyDataItem, openCommand?: string) => {
      let { nvim } = this
      await nvim.call('win_gotoid', [winid])
      await workspace.jumpTo(item.uri, item.selectionRange.start, openCommand)
      let win = await nvim.window
      win.clearMatchGroup(HIGHLIGHT_GROUP)
      win.highlightRanges(HIGHLIGHT_GROUP, [item.selectionRange], 10, true)
      if (isFalsyOrEmpty(item.ranges)) return
      if (item.sourceUri) {
        let doc = workspace.getDocument(item.sourceUri)
        if (!doc) return
        let winid = await nvim.call('coc#compat#buf_win_id', [doc.bufnr]) as number
        if (winid == -1) return
        if (winid != win.id) {
          win = nvim.createWindow(winid)
          win.clearMatchGroup(HIGHLIGHT_GROUP)
        }
      }
      win.highlightRanges(HIGHLIGHT_GROUP, item.ranges, 100, true)
      this.highlightWinids.add(win.id)
    }, null, true))
    events.on('BufWinEnter', (_, winid) => {
      if (this.highlightWinids.has(winid)) {
        this.highlightWinids.delete(winid)
        let win = nvim.createWindow(winid)
        win.clearMatchGroup(HIGHLIGHT_GROUP)
      }
    }, null, this.disposables)

    commands.register({
      id: 'document.showIncomingCalls',
      execute: async () => {
        await this.showCallHierarchyTree('incoming')
      }
    }, false, 'show incoming calls in tree view.')
    commands.register({
      id: 'document.showOutgoingCalls',
      execute: async () => {
        await this.showCallHierarchyTree('outgoing')
      }
    }, false, 'show outgoing calls in tree view.')
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('callHierarchy')) {
      let c = workspace.getConfiguration('callHierarchy', null)
      this.config = {
        splitCommand: c.get<string>('splitCommand'),
        openCommand: c.get<string>('openCommand'),
        enableTooltip: c.get<boolean>('enableTooltip')
      }
    }
  }

  private createProvider(rootItems: CallHierarchyDataItem[], doc: TextDocument, winid: number, kind: 'incoming' | 'outgoing'): CallHierarchyProvider {
    let provider = new LocationsDataProvider<CallHierarchyDataItem, 'incoming' | 'outgoing'>(
      kind,
      winid,
      this.config,
      CallHierarchyHandler.commandId,
      rootItems,
      kind => this.handler.getIcon(kind),
      (el, meta, token) => this.getChildren(doc, el, meta, token)
    )
    for (let kind of ['incoming', 'outgoing']) {
      let name = kind === 'incoming' ? ShowHierarchyAction.Incoming : ShowHierarchyAction.Outgoing
      provider.addAction(name, (el: CallHierarchyDataItem) => {
        provider.meta = kind as 'incoming' | 'outgoing'
        let rootItems = [toCallHierarchyItem(el)]
        provider.reset(rootItems)
      })
    }
    return provider
  }

  private async getChildren(doc: TextDocument, item: CallHierarchyDataItem, kind: 'incoming' | 'outgoing', token: CancellationToken): Promise<CallHierarchyDataItem[]> {
    let items: CallHierarchyDataItem[] = []
    let callHierarchyItem = toCallHierarchyItem(item)
    if (kind == 'incoming') {
      let res = await languages.provideIncomingCalls(doc, callHierarchyItem, token)
      if (res) items = res.map(o => Object.assign(o.from, { ranges: o.fromRanges }))
    } else {
      let res = await languages.provideOutgoingCalls(doc, callHierarchyItem, token)
      if (res) items = res.map(o => Object.assign(o.to, { ranges: o.fromRanges, sourceUri: item.uri }))
    }
    return items
  }

  private async prepare(doc: TextDocument, position: Position, token: CancellationToken): Promise<CallHierarchyItem[] | undefined> {
    this.handler.checkProvider(ProviderName.CallHierarchy, doc)
    const res = await languages.prepareCallHierarchy(doc, position, token)
    return isCallHierarchyItem(res) ? [res] : res
  }

  private async getCallHierarchyItems(item: CallHierarchyItem | undefined, kind: 'outgoing'): Promise<CallHierarchyOutgoingCall[]>
  private async getCallHierarchyItems(item: CallHierarchyItem | undefined, kind: 'incoming'): Promise<CallHierarchyIncomingCall[]>
  private async getCallHierarchyItems(item: CallHierarchyItem | undefined, kind: 'incoming' | 'outgoing'): Promise<(CallHierarchyIncomingCall | CallHierarchyOutgoingCall)[]> {
    const { doc, position } = await this.handler.getCurrentState()
    const source = new CancellationTokenSource()
    if (!item) {
      await doc.synchronize()
      let res = await this.prepare(doc.textDocument, position, source.token)
      item = res ? res[0] : undefined
      if (!res) throw new Error('Unable to getCallHierarchyItem at current position')
    }
    let method = kind == 'incoming' ? 'provideIncomingCalls' : 'provideOutgoingCalls'
    return await languages[method](doc.textDocument, item, source.token)
  }

  public async getIncoming(item?: CallHierarchyItem): Promise<CallHierarchyIncomingCall[] | undefined> {
    return await this.getCallHierarchyItems(item, 'incoming')
  }

  public async getOutgoing(item?: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[] | undefined> {
    return await this.getCallHierarchyItems(item, 'outgoing')
  }

  public async showCallHierarchyTree(kind: 'incoming' | 'outgoing'): Promise<void> {
    const { doc, position, winid } = await this.handler.getCurrentState()
    await doc.synchronize()
    if (!languages.hasProvider(ProviderName.CallHierarchy, doc.textDocument)) {
      void window.showErrorMessage(`CallHierarchy provider not found for current document, it's not supported by your languageserver`)
      return
    }
    const res = await languages.prepareCallHierarchy(doc.textDocument, position, CancellationToken.None)
    const rootItems: CallHierarchyItem[] = isCallHierarchyItem(res) ? [res] : res
    if (isFalsyOrEmpty(rootItems)) {
      void window.showWarningMessage('Unable to get CallHierarchyItem at cursor position.')
      return
    }
    let provider = this.createProvider(rootItems, doc.textDocument, winid, kind)
    let treeView = new BasicTreeView('calls', { treeDataProvider: provider })
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

function getTitle(kind: string): string {
  return `${kind.toUpperCase()} CALLS`
}
