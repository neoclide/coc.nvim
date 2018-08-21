import { CancellationToken, Disposable, DocumentSelector, FoldingRange, TextDocument } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { FoldingContext, FoldingRangeProvider } from './index'
import uuid = require('uuid/v4')

export interface ProviderItem {
  id: string
  selector: DocumentSelector
  provider: FoldingRangeProvider
  score?: number
}

export default class FoldingRangeManager implements Disposable {
  private providers: Set<ProviderItem> = new Set()

  public register(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    let item: ProviderItem = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  private getProvider(document: TextDocument): ProviderItem | null {
    let items = Array.from(this.providers)
    let provider: ProviderItem
    for (let item of items) {
      let { selector } = item
      let score = workspace.match(selector, document)
      if (score == 10) return item
      item.score = score
      if (!provider || score > provider.score) {
        provider = item
      }
    }
    return provider
  }

  public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return await Promise.resolve(provider.provideFoldingRanges(document, context, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
