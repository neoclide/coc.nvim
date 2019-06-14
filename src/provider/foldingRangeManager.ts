import { CancellationToken, Disposable, DocumentSelector, FoldingRange, TextDocument } from 'vscode-languageserver-protocol'
import { FoldingContext, FoldingRangeProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class FoldingRangeManager extends Manager<FoldingRangeProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    let item: ProviderItem<FoldingRangeProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return (await Promise.resolve(provider.provideFoldingRanges(document, context, token)) || [])
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
