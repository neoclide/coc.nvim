'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlineCompletionContext, InlineCompletionItem, InlineCompletionList, Position } from 'vscode-languageserver-types'
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

  public async provideInlineCompletionItems(
    document: TextDocument,
    position: Position,
    context: InlineCompletionContext,
    token: CancellationToken
  ): Promise<InlineCompletionList | InlineCompletionItem[]> {
    const item = this.getProvider(document)
    if (!item) return

    const { provider } = item
    let res: InlineCompletionList | InlineCompletionItem[] = null
    try {
      res = await Promise.resolve(provider.provideInlineCompletionItems(document, position, context, token))
    } catch (e) {
      this.handleResults([{ status: 'rejected', reason: e }], 'provideInlineCompletionItems')
    }
    return res
  }
}
