'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, DefinitionLink, Disposable, DocumentSelector, Location, LocationLink, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DefinitionProvider } from './index'
import Manager from './manager'
const logger = require('../util/logger')('definitionManager')

export default class DefinitionManager extends Manager<DefinitionProvider> {

  public register(selector: DocumentSelector, provider: DefinitionProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<Location[] | null> {
    const providers = this.getProviders(document)
    let locations: Location[] = []
    const results = await Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideDefinition(document, position, token)).then(location => {
        this.addLocation(locations, location)
      })
    }))
    this.handleResults(results, 'provideDefinition')
    return locations
  }

  public async provideDefinitionLinks(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<DefinitionLink[] | null> {
    const providers = this.getProviders(document)
    let locations: DefinitionLink[] = []
    const results = await Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideDefinition(document, position, token)).then(location => {
        if (Array.isArray(location)) {
          location.forEach(loc => {
            if (LocationLink.is(loc)) {
              locations.push(loc)
            }
          })
        }
      })
    }))
    this.handleResults(results, 'provideDefinition')
    return locations
  }
}
