'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlineCompletionContext, InlineCompletionItem, Position } from 'vscode-languageserver-types'
import { toArray } from '../util/array'
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
    let providers: ProviderItem<InlineCompletionItemProvider>[] = []
    if (context.provider) {
      let item = this.getProvideByExtension(document, context.provider)
      if (item) providers = [item]
    } else {
      providers = this.getProviders(document)
    }
    const items: InlineCompletionItem[] = []
    const promise = Promise.allSettled(providers.map(item => {
      let provider = item.provider
      return Promise.resolve(provider.provideInlineCompletionItems(document, position, omit(context, ['provider']), token)).then(result => {
        let list = Array.isArray(result) ? result : toArray(result?.items)
        for (let item of list) {
          Object.defineProperty(item, 'provider', {
            get: () => provider['__extensionName'],
            enumerable: false
          })
          items.push(item)
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
