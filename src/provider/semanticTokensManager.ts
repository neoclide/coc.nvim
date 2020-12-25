import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { SemanticTokensEdits } from '../semanticTokens'
import { DocumentSemanticTokensProvider } from './index'
import Manager, { ProviderItem } from './manager'

export default class SemanticTokensManager extends Manager<DocumentSemanticTokensProvider> implements Disposable {
  private _legend: SemanticTokensLegend

  public register(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    // TODO: SemantiTokens
    this._legend = legend
    let item: ProviderItem<DocumentSemanticTokensProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    if (provider.provideDocumentSemanticTokens === null) return null

    return await Promise.resolve(provider.provideDocumentSemanticTokens(document, token))
  }

  public async provideDocumentSemanticTokensEdits(document: TextDocument, previousResultId: string, token: CancellationToken): Promise<SemanticTokens | SemanticTokensEdits> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    if (provider.provideDocumentSemanticTokensEdits === null) return null

    return await Promise.resolve(provider.provideDocumentSemanticTokensEdits(document, previousResultId, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
