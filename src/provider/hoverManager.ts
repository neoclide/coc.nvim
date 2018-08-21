import { CancellationToken, Disposable, DocumentSelector, Hover, Position, TextDocument } from 'vscode-languageserver-protocol'
import { HoverProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class HoverManager extends Manager<HoverProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: HoverProvider): Disposable {
    let item: ProviderItem<HoverProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Hover | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    for (let item of providers) {
      let { provider } = item
      let hover = await Promise.resolve(provider.provideHover(document, position, token))
      if (hover) return hover
    }
    return null
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
