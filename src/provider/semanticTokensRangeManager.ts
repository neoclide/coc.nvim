'use strict'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Range, SemanticTokens, SemanticTokensLegend } from 'vscode-languageserver-types'
import type { CancellationToken, Disposable } from '../util/protocol'
import { DocumentRangeSemanticTokensProvider, DocumentSelector } from './index'
import Manager from './manager'

interface ProviderMeta {
  legend: SemanticTokensLegend
}

export default class SemanticTokensRangeManager extends Manager<DocumentRangeSemanticTokensProvider, ProviderMeta> {
  public register(selector: DocumentSelector, provider: DocumentRangeSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    return this.addProvider({
      id: crypto.randomUUID(),
      selector,
      legend,
      provider
    })
  }

  public getLegend(document: TextDocument): SemanticTokensLegend {
    const item = this.getProvider(document)
    if (!item) return
    return item.legend
  }

  public async provideDocumentRangeSemanticTokens(document: TextDocument, range: Range, token: CancellationToken): Promise<SemanticTokens> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return await Promise.resolve(provider.provideDocumentRangeSemanticTokens(document, range, token))
  }
}
