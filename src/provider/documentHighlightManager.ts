'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentHighlight, Position } from 'vscode-languageserver-types'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentHighlightProvider, DocumentSelector } from './index'
import Manager from './manager'

export default class DocumentHighlightManager extends Manager<DocumentHighlightProvider> {

  public register(selector: DocumentSelector, provider: DocumentHighlightProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideDocumentHighlights(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<DocumentHighlight[]> {
    let items = this.getProviders(document)
    let res: DocumentHighlight[] = null
    for (const item of items) {
      try {
        res = await Promise.resolve(item.provider.provideDocumentHighlights(document, position, token))
        if (res != null) break
      } catch (e) {
        this.handleResults([{ status: 'rejected', reason: e }], 'provideDocumentHighlights')
      }
    }
    return res
  }
}
