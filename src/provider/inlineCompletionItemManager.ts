'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlineCompletionContext, InlineCompletionItem, Position } from 'vscode-languageserver-types'
import { onUnexpectedError } from '../util/errors'
import { omit } from '../util/lodash'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, InlineCompletionItemProvider } from './index'
import Manager, { ProviderItem } from './manager'

export interface ExtendedInlineContext extends InlineCompletionContext {
  provider?: string
}

export default class InlineCompletionItemManager extends Manager<InlineCompletionItemProvider> {
  public register(selector: DocumentSelector, provider: InlineCompletionItemProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public get isEmpty(): boolean {
    return this.providers.size === 0
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are asked in
   * parallel and the results are merged. A failing provider (rejected promise or exception) will
   * not cause a failure of the whole operation.
   */
  public async provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    context: ExtendedInlineContext,
    token: CancellationToken
  ): Promise<InlineCompletionItem[]> {
    let providers: ProviderItem<InlineCompletionItemProvider>[]
    if (context.provider) {
      let item = this.getProvideByExtension(document, context.provider)
      if (item) providers = [item]
    } else {
      providers = this.getProviders(document)
    }
    const items: InlineCompletionItem[] = []
    const promise = Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideInlineCompletionItems(document, position, omit(context, ['provider']), token)).then(result => {
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
