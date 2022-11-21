'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position } from 'vscode-languageserver-types'
import { LocationWithTarget } from '../types'
import type { CancellationToken, Disposable } from '../util/protocol'
import { TypeDefinitionProvider, DocumentSelector } from './index'
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
