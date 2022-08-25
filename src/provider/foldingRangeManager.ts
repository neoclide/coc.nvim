'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, FoldingRange } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { FoldingContext, FoldingRangeProvider } from './index'
import Manager from './manager'

export default class FoldingRangeManager extends Manager<FoldingRangeProvider>  {

  public register(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return (await Promise.resolve(provider.provideFoldingRanges(document, context, token)) || [])
  }
}
