'use strict'
import { v4 as uuid } from 'uuid'
import type { CancellationToken, Disposable, DocumentSelector, Position, ReferenceContext } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { LocationWithTarget } from '../types'
import type { ReferenceProvider } from './index'
import Manager from './manager'

export default class ReferenceManager extends Manager<ReferenceProvider>  {

  public register(selector: DocumentSelector, provider: ReferenceProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideReferences(
    document: TextDocument,
    position: Position,
    context: ReferenceContext,
    token: CancellationToken
  ): Promise<LocationWithTarget[]> {
    const providers = this.getProviders(document)
    let locations: LocationWithTarget[] = []
    const results = await Promise.allSettled(providers.map(item => {
      return Promise.resolve(item.provider.provideReferences(document, position, context, token)).then(location => {
        this.addLocation(locations, location)
      })
    }))
    this.handleResults(results, 'provideReferences')
    return locations
  }
}
