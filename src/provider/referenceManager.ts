'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Location, Position, ReferenceContext } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { ReferenceProvider } from './index'
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
  ): Promise<Location[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider } = item
      return Promise.resolve(provider.provideReferences(document, position, context, token))
    }))
    return this.toLocations(arr)
  }
}
