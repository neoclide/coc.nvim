'use strict'
import { v4 as uuid } from 'uuid'
import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, Position } from 'vscode-languageserver-types'
import { CancellationToken, Disposable } from '../util/protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CallHierarchyProvider, DocumentSelector } from './index'
import Manager from './manager'

export default class CallHierarchyManager extends Manager<CallHierarchyProvider> {

  public register(selector: DocumentSelector, provider: CallHierarchyProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async prepareCallHierarchy(document: TextDocument, position: Position, token: CancellationToken): Promise<CallHierarchyItem | CallHierarchyItem[]> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return await Promise.resolve(provider.prepareCallHierarchy(document, position, token))
  }

  public async provideCallHierarchyOutgoingCalls(document: TextDocument, item: CallHierarchyItem, token: CancellationToken): Promise<CallHierarchyOutgoingCall[]> {
    let providerItem = this.getProvider(document)
    if (!providerItem) return null
    let { provider } = providerItem
    return await Promise.resolve(provider.provideCallHierarchyOutgoingCalls(item, token))
  }

  public async provideCallHierarchyIncomingCalls(document: TextDocument, item: CallHierarchyItem, token: CancellationToken): Promise<CallHierarchyIncomingCall[]> {
    let providerItem = this.getProvider(document)
    if (!providerItem) return null
    let { provider } = providerItem
    return await Promise.resolve(provider.provideCallHierarchyIncomingCalls(item, token))
  }
}
