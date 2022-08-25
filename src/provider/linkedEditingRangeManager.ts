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

  public async provideLinkedEditingRanges(document: TextDocument, position: Position, token: CancellationToken): Promise<LinkedEditingRanges> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    if (!provider.provideLinkedEditingRanges) return null

    return await Promise.resolve(provider.provideLinkedEditingRanges(document, position, token))
  }
}
