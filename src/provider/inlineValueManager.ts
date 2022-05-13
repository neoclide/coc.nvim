'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, InlineValue, InlineValueContext, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlineValuesProvider } from '.'
import Manager, { ProviderItem } from './manager'

export default class InlineValueManager extends Manager<InlineValuesProvider> {

  public register(selector: DocumentSelector, provider: InlineValuesProvider): Disposable {
    let item: ProviderItem<InlineValuesProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideInlineValues(document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken): Promise<InlineValue[]> {
    const item = this.getProvider(document)
    if (!item) return []

    const { provider } = item
    if (provider.provideInlineValues === null) return []

    return await Promise.resolve(provider.provideInlineValues(document, viewPort, context, token))
  }
}
