'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlineValue, InlineValueContext, Range } from 'vscode-languageserver-types'
import { equals } from '../util/object'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, InlineValuesProvider } from './index'
import Manager from './manager'

export default class InlineValueManager extends Manager<InlineValuesProvider> {

  public register(selector: DocumentSelector, provider: InlineValuesProvider): Disposable {
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
  public async provideInlineValues(document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken): Promise<InlineValue[]> {
    const items = this.getProviders(document)
    const values: InlineValue[] = []
    const results = await Promise.allSettled(items.map(item => {
      return Promise.resolve(item.provider.provideInlineValues(document, viewPort, context, token)).then(arr => {
        if (!Array.isArray(arr)) return
        let noCheck = values.length === 0
        for (let value of arr) {
          if (noCheck || values.every(o => !equals(o, value))) {
            values.push(value)
          }
        }
      })
    }))
    this.handleResults(results, 'provideInlineValues')
    return values
  }
}
