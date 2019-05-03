import { CancellationToken, Disposable, DocumentSelector, SymbolInformation, TextDocument } from 'vscode-languageserver-protocol'
import { WorkspaceSymbolProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class WorkspaceSymbolManager extends Manager<WorkspaceSymbolProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: WorkspaceSymbolProvider): Disposable {
    let item: ProviderItem<WorkspaceSymbolProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideWorkspaceSymbols(
    document: TextDocument,
    query: string,
    token: CancellationToken
  ): Promise<SymbolInformation[]> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    let res = await Promise.resolve(provider.provideWorkspaceSymbols(query, token))
    res = res || []
    for (let sym of res) {
      (sym as any).source = item.id
    }
    return res
  }

  public async resolveWorkspaceSymbol(
    symbolInfo: SymbolInformation,
    token: CancellationToken
  ): Promise<SymbolInformation> {
    let item = Array.from(this.providers).find(o => o.id == (symbolInfo as any).source)
    if (!item) return
    let { provider } = item
    if (typeof provider.resolveWorkspaceSymbol != 'function') {
      return Promise.resolve(symbolInfo)
    }
    return await Promise.resolve(provider.resolveWorkspaceSymbol(symbolInfo, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
