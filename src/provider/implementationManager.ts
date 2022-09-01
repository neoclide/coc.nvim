'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { LocationWithTarget } from '../types'
import { ImplementationProvider } from './index'
import Manager from './manager'

export default class ImplementationManager extends Manager<ImplementationProvider> {

  public register(selector: DocumentSelector, provider: ImplementationProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideImplementations(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<LocationWithTarget[]> {
    const providers = this.getProviders(document)
    let locations: LocationWithTarget[] = []
    const results = await Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideImplementation(document, position, token)).then(location => {
        this.addLocation(locations, location)
      })
    }))
    this.handleResults(results, 'provideImplementations')
    return locations
  }
}
