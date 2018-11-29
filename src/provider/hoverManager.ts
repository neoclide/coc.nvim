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
    let item = this.getProvider(document)
    if (!item) return null
    let hover = await Promise.resolve(item.provider.provideHover(document, position, token))
    return hover || null
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
