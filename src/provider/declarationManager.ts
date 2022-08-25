'use strict'
import { CancellationToken, Disposable, DocumentSelector, Location, Position, LocationLink } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DeclarationProvider } from './index'
import Manager, { ProviderItem } from './manager'
import { v4 as uuid } from 'uuid'
const logger = require('../util/logger')('definitionManager')

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
  ): Promise<Location[] | Location | LocationLink[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return await Promise.resolve(provider.provideDeclaration(document, position, token))
  }
}
