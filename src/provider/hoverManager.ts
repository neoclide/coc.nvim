'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Hover, Position } from 'vscode-languageserver-types'
import { equals } from '../util/object'
import { CancellationToken, Disposable } from '../util/protocol'
import { HoverProvider, DocumentSelector } from './index'
import Manager from './manager'

export default class HoverManager extends Manager<HoverProvider> {

  public register(selector: DocumentSelector, provider: HoverProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Hover[]> {
    let items = this.getProviders(document)
    let hovers: Hover[] = []
    let results = await Promise.allSettled(items.map(item => {
      return Promise.resolve(item.provider.provideHover(document, position, token)).then(hover => {
        if (!Hover.is(hover)) return
        if (hovers.findIndex(o => equals(o.contents, hover.contents)) == -1) {
          hovers.push(hover)
        }
      })
    }))
    this.handleResults(results, 'provideHover')
    return hovers
  }
}
