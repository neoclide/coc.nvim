'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position } from 'vscode-languageserver-types'
import { LocationWithTarget } from '../types'
import { CancellationToken, Disposable } from '../util/protocol'
import { DeclarationProvider, DocumentSelector } from './index'
import Manager from './manager'

export default class DeclarationManager extends Manager<DeclarationProvider> {

  public register(selector: DocumentSelector, provider: DeclarationProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideDeclaration(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<LocationWithTarget[]> {
    const providers = this.getProviders(document)
    let locations: LocationWithTarget[] = []
    const results = await Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideDeclaration(document, position, token)).then(location => {
        this.addLocation(locations, location)
      })
    }))
    this.handleResults(results, 'provideDeclaration')
    return locations
  }
}
