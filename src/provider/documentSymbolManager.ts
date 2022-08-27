'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, DocumentSymbol, SymbolInformation } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentSymbolProvider, DocumentSymbolProviderMetadata } from './index'
import Manager from './manager'

export default class DocumentSymbolManager extends Manager<DocumentSymbolProvider> {

  public register(selector: DocumentSelector, provider: DocumentSymbolProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public getMetaData(document: TextDocument): DocumentSymbolProviderMetadata | null {
    let item = this.getProvider(document)
    if (!item) return null
    return item.provider.meta ?? {}
  }

  public async provideDocumentSymbols(
    document: TextDocument,
    token: CancellationToken
  ): Promise<SymbolInformation[] | DocumentSymbol[]> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return (await Promise.resolve(provider.provideDocumentSymbols(document, token))) ?? []
  }
}
