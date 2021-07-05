import { Neovim } from '@chemzqm/neovim'
import { CallHierarchyIncomingCall, Range, CallHierarchyItem, CallHierarchyOutgoingCall, CancellationTokenSource } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { HandlerDelegate } from '../types'

function isCallHierarchyItem(item: any): item is CallHierarchyItem {
  if (item.name && item.kind && Range.is(item.range) && item.uri) return true
  return false
}

export default class CallHierarchyHandler {
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
  }

  private async prepare(): Promise<CallHierarchyItem> {
    const { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('callHierarchy', doc.textDocument)
    await doc.synchronize()
    const source = new CancellationTokenSource()
    const res = await languages.prepareCallHierarchy(doc.textDocument, position, source.token)
    if (!res || source.token.isCancellationRequested) return undefined
    return Array.isArray(res) ? res[0] : res
  }

  public async getIncoming(item?: CallHierarchyItem): Promise<CallHierarchyIncomingCall[]> {
    if (!item) item = await this.prepare()
    if (!isCallHierarchyItem(item)) throw new Error('Not a CallHierarchyItem')
    const source = new CancellationTokenSource()
    return await languages.provideIncomingCalls(item, source.token)
  }

  public async getOutgoing(item?: CallHierarchyItem): Promise<CallHierarchyOutgoingCall[]> {
    if (!item) item = await this.prepare()
    if (!isCallHierarchyItem(item)) throw new Error('Not a CallHierarchyItem')
    const source = new CancellationTokenSource()
    return await languages.provideOutgoingCalls(item, source.token)
  }
}
