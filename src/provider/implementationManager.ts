import { CancellationToken, Disposable, DocumentSelector, Location, Position, TextDocument } from 'vscode-languageserver-protocol'
import { ImplementationProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class ImplementationManager extends Manager<ImplementationProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: ImplementationProvider): Disposable {
    let item: ProviderItem<ImplementationProvider> = {
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
    token: CancellationToken
  ): Promise<Location[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider } = item
      return Promise.resolve(provider.provideImplementation(document, position, token))
    }))
    return this.mergeDefinitions(arr)
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
