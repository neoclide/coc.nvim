import { CancellationToken, Disposable, DocumentSelector, DocumentSymbol, SymbolInformation, TextDocument } from 'vscode-languageserver-protocol'
import { DocumentSymbolProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class DocumentSymbolManager extends Manager<DocumentSymbolProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: DocumentSymbolProvider): Disposable {
    let item: ProviderItem<DocumentSymbolProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideDocumentSymbols(
    document: TextDocument,
    token: CancellationToken
  ): Promise<SymbolInformation[] | DocumentSymbol[]> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return (await Promise.resolve(provider.provideDocumentSymbols(document, token))) || []
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
