'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { LocationWithTarget } from '../types'
import { TypeDefinitionProvider } from './index'
import Manager from './manager'

export default class TypeDefinitionManager extends Manager<TypeDefinitionProvider> {

  public register(selector: DocumentSelector, provider: TypeDefinitionProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideTypeDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<LocationWithTarget[]> {
    const providers = this.getProviders(document)
    let locations: LocationWithTarget[] = []
    const results = await Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideTypeDefinition(document, position, token)).then(location => {
        this.addLocation(locations, location)
      })
    }))
    this.handleResults(results, 'provideTypeDefinition')
    return locations
  }
}
