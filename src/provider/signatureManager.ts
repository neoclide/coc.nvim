'use strict'
import { v4 as uuid } from 'uuid'
import type { SignatureHelpContext } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, SignatureHelp } from 'vscode-languageserver-types'
import { isFalsyOrEmpty } from '../util/array'
import type { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, SignatureHelpProvider } from './index'
import Manager from './manager'

interface ProviderMeta {
  triggerCharacters: string[] | undefined
}

export default class SignatureManager extends Manager<SignatureHelpProvider, ProviderMeta> {

  public register(selector: DocumentSelector, provider: SignatureHelpProvider, triggerCharacters: string[] | undefined): Disposable {
    triggerCharacters = isFalsyOrEmpty(triggerCharacters) ? [] : triggerCharacters
    let characters = triggerCharacters.reduce((p, c) => p.concat(c.length == 1 ? [c] : c.split(/\s*/g)), [] as string[])
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      triggerCharacters: characters
    })
  }

  public shouldTrigger(document: TextDocument, triggerCharacter: string): boolean {
    let items = this.getProviders(document)
    if (items.length === 0) return false
    for (let item of items) {
      if (item.triggerCharacters.includes(triggerCharacter)) {
        return true
      }
    }
    return false
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are sorted
   * by their {@link languages.match score} and called sequentially until a provider returns a
   * valid result.
   */
  public async provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: SignatureHelpContext
  ): Promise<SignatureHelp | null> {
    let items = this.getProviders(document)
    for (const item of items) {
      let res = await Promise.resolve(item.provider.provideSignatureHelp(document, position, token, context))
      if (res && res.signatures && res.signatures.length > 0) return res
    }
    return null
  }
}
