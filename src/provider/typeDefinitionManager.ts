import { CancellationToken, Disposable, DocumentSelector, Location, Position, TextDocument } from 'vscode-languageserver-protocol'
import { TypeDefinitionProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class TypeDefinitionManager extends Manager<TypeDefinitionProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: TypeDefinitionProvider): Disposable {
    let item: ProviderItem<TypeDefinitionProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideTypeDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Location[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider } = item
      return Promise.resolve(provider.provideTypeDefinition(document, position, token))
    }))
    return this.mergeDefinitions(arr)
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
