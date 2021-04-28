import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentSemanticTokensProvider } from './index'
import Manager, { ProviderItem } from './manager'
const logger = require('../util/logger')('semanticTokensManager')

export default class SemanticTokensManager extends Manager<DocumentSemanticTokensProvider> implements Disposable {
  private _legend: SemanticTokensLegend

  public register(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
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

  public get legend(): SemanticTokensLegend {
    return this._legend
  }

  public hasEditProvider(document: TextDocument): boolean {
    let item = this.getProvider(document)
    if (!item) return false

    return (typeof item.provider.provideDocumentSemanticTokensEdits === 'function')
  }

  public async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    if (!provider.provideDocumentSemanticTokens) return null

    return await Promise.resolve(provider.provideDocumentSemanticTokens(document, token))
  }

  public async provideDocumentSemanticTokensEdits(document: TextDocument, previousResultId: string, token: CancellationToken): Promise<SemanticTokens | SemanticTokensDelta> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    if (!provider.provideDocumentSemanticTokensEdits) return null

    return await Promise.resolve(provider.provideDocumentSemanticTokensEdits(document, previousResultId, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
