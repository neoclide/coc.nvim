import { CancellationToken, Disposable, DocumentSelector, Location, Position, ReferenceContext, TextDocument } from 'vscode-languageserver-protocol'
import { ReferenceProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class ReferenceManager extends Manager<ReferenceProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: ReferenceProvider): Disposable {
    let item: ProviderItem<ReferenceProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideReferences(
    document: TextDocument,
    position: Position,
    context: ReferenceContext,
    token: CancellationToken
  ): Promise<Location[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider } = item
      return Promise.resolve(provider.provideReferences(document, position, context, token))
    }))
    return this.mergeDefinitions(arr)
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
