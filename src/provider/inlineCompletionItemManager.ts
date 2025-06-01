'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlineCompletionContext, InlineCompletionItem, Position } from 'vscode-languageserver-types'
import { onUnexpectedError } from '../util/errors'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, InlineCompletionItemProvider } from './index'
import Manager from './manager'

export default class InlineCompletionItemManager extends Manager<InlineCompletionItemProvider> {
  public register(selector: DocumentSelector, provider: InlineCompletionItemProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are asked in
   * parallel and the results are merged. A failing provider (rejected promise or exception) will
   * not cause a failure of the whole operation.
   */
  public async provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    context: InlineCompletionContext,
    token: CancellationToken
  ): Promise<InlineCompletionItem[]> {
    const providers = this.getProviders(document)
    const items: InlineCompletionItem[] = []
    const promise = Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideInlineCompletionItems(document, position, context, token)).then(result => {
        if (Array.isArray(result)) {
          items.push(...result)
        } else if (result?.items) {
          items.push(...result.items)
        }
      })
    }))
    let disposable: Disposable
    await Promise.race([new Promise(resolve => {
      disposable = token.onCancellationRequested(() => {
        resolve(undefined)
      })
    }), promise.then(results => {
      if (!token.isCancellationRequested) this.handleResults(results, 'provideInlineCompletionItems')
    })]).catch(onUnexpectedError)
    if (disposable) disposable.dispose()
    return items
  }
}
