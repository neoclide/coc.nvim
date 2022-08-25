'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Hover, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { HoverProvider } from './index'
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
  ): Promise<Hover[] | null> {
    let items = this.getProviders(document)
    if (items.length === 0) return null
    let res = []
    for (let i = 0, len = items.length; i < len; i += 1) {
      const item = items[i]
      let hover = await Promise.resolve(item.provider.provideHover(document, position, token))
      if (hover && hover.contents != '') res.push(hover)
    }
    return res
  }
}
