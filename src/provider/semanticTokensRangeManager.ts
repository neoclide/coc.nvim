import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Range, SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentRangeSemanticTokensProvider } from './index'
import Manager, { ProviderItem } from './manager'

export default class SemanticTokensRangeManager extends Manager<DocumentRangeSemanticTokensProvider> implements Disposable {
  private _legend: SemanticTokensLegend

  public register(selector: DocumentSelector, provider: DocumentRangeSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    // TODO: SemantiTokens
    this._legend = legend
    let item: ProviderItem<DocumentRangeSemanticTokensProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideDocumentRangeSemanticTokens(document: TextDocument, range: Range, token: CancellationToken): Promise<SemanticTokens> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
  if (provider.provideDocumentRangeSemanticTokens === null) return null

    return await Promise.resolve(provider.provideDocumentRangeSemanticTokens(document, range, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
