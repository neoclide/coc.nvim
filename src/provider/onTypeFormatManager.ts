'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Position, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import workspace from '../workspace'
import { OnTypeFormattingEditProvider } from './index'
import Manager from './manager'
const logger = require('../util/logger')('onTypeFormatManager')

export interface ProviderMeta {
  triggerCharacters: string[]
}

export default class OnTypeFormatManager extends Manager<OnTypeFormattingEditProvider, ProviderMeta> {

  public register(selector: DocumentSelector, provider: OnTypeFormattingEditProvider, triggerCharacters: string[] | undefined): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      triggerCharacters: triggerCharacters ?? []
    })
  }

  public couldTrigger(document: TextDocument, triggerCharacter: string): OnTypeFormattingEditProvider | null {
    for (let o of this.providers) {
      let { triggerCharacters, selector } = o
      if (workspace.match(selector, document) > 0 && triggerCharacters.includes(triggerCharacter)) {
        return o.provider
      }
    }
    return null
  }

  public async onCharacterType(character: string, document: TextDocument, position: Position, token: CancellationToken): Promise<TextEdit[] | null> {
    let items = this.getProviders(document)
    let item = items.find(o => o.triggerCharacters.includes(character))
    if (!item) return null
    let formatOpts = await workspace.getFormatOptions(document.uri)
    return await Promise.resolve(item.provider.provideOnTypeFormattingEdits(document, position, character, formatOpts, token))
  }
}
