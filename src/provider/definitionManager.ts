import { CancellationToken, Disposable, DocumentSelector, Location, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DefinitionProvider } from './index'
import Manager, { ProviderItem } from './manager'
import { v4 as uuid } from 'uuid'
const logger = require('../util/logger')('definitionManager')

export default class DefinitionManager extends Manager<DefinitionProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: DefinitionProvider): Disposable {
    let item: ProviderItem<DefinitionProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Location[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider } = item
      return Promise.resolve(provider.provideDefinition(document, position, token))
    }))
    return this.toLocations(arr)
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
