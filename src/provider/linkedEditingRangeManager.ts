'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, LinkedEditingRanges, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { LinkedEditingRangeProvider } from './index'
import Manager from './manager'
const logger = require('../util/logger')('linkedEditingManager')

export default class LinkedEditingRangeManager extends Manager<LinkedEditingRangeProvider> {
  public register(selector: DocumentSelector, provider: LinkedEditingRangeProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are sorted
   * by their {@link workspace.match score} and the best-matching provider that has a result is used. Failure
   * of the selected provider will cause a failure of the whole operation.
   */
  public async provideLinkedEditingRanges(document: TextDocument, position: Position, token: CancellationToken): Promise<LinkedEditingRanges> {
    let items = this.getProviders(document)
    for (let item of items) {
      let res: LinkedEditingRanges | undefined
      try {
        res = await Promise.resolve(item.provider.provideLinkedEditingRanges(document, position, token))
        if (res != null) return res
      } catch (e) {
        logger.error(`Error on provideLinkedEditingRanges: `, e)
      }
    }
    return null
  }
}
