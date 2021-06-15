import { CancellationToken, Disposable, DocumentSelector, DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentSymbolProvider } from './index'
import Manager, { ProviderItem } from './manager'
import { v4 as uuid } from 'uuid'

export default class DocumentSymbolManager extends Manager<DocumentSymbolProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: DocumentSymbolProvider, displayName?: string): Disposable {
    let item: ProviderItem<DocumentSymbolProvider> = {
      id: uuid(),
      displayName,
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
