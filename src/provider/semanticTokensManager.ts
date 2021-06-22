import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentSemanticTokensProvider } from './index'
import Manager, { ProviderItem } from './manager'
const logger = require('../util/logger')('semanticTokensManager')

export default class SemanticTokensManager extends Manager<DocumentSemanticTokensProvider> implements Disposable {
  public register(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    let item: ProviderItem<DocumentSemanticTokensProvider> = {
      id: uuid(),
      selector,
      legend,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public getLegend(document: TextDocument): SemanticTokensLegend {
    const item = this.getProvider(document)
    if (!item) return

    return item.provider.legend || item.legend
  }

  public hasSemanticTokensEdits(document: TextDocument): boolean {
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
