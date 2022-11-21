'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { SemanticTokens, SemanticTokensDelta, SemanticTokensLegend } from 'vscode-languageserver-types'
import type { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSemanticTokensProvider, DocumentSelector } from './index'
import Manager from './manager'

interface ProviderMeta {
  legend: SemanticTokensLegend
}

export default class SemanticTokensManager extends Manager<DocumentSemanticTokensProvider, ProviderMeta> {

  public register(selector: DocumentSelector, provider: DocumentSemanticTokensProvider, legend: SemanticTokensLegend): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      legend,
    })
  }

  public getLegend(document: TextDocument): SemanticTokensLegend {
    const item = this.getProvider(document)
    if (!item) return
    return item.legend
  }

  public hasSemanticTokensEdits(document: TextDocument): boolean {
    let provider = this.getProvider(document)?.provider
    if (!provider) return false
    return (typeof provider.provideDocumentSemanticTokensEdits === 'function')
  }

  public async provideDocumentSemanticTokens(document: TextDocument, token: CancellationToken): Promise<SemanticTokens | null> {
    let provider = this.getProvider(document)?.provider
    if (!provider || typeof provider.provideDocumentSemanticTokens !== 'function') return null
    return await Promise.resolve(provider.provideDocumentSemanticTokens(document, token))
  }

  public async provideDocumentSemanticTokensEdits(document: TextDocument, previousResultId: string, token: CancellationToken): Promise<SemanticTokens | SemanticTokensDelta | null> {
    let item = this.getProvider(document)
    if (!item || typeof item.provider.provideDocumentSemanticTokensEdits !== 'function') return null
    return await Promise.resolve(item.provider.provideDocumentSemanticTokensEdits(document, previousResultId, token))
  }
}
