'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Position, SignatureHelp, SignatureHelpContext } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { SignatureHelpProvider } from './index'
import Manager from './manager'

interface ProviderMeta {
  triggerCharacters: string[] | undefined
}

export default class SignatureManager extends Manager<SignatureHelpProvider, ProviderMeta> {

  public register(selector: DocumentSelector, provider: SignatureHelpProvider, triggerCharacters: string[] | undefined): Disposable {
    triggerCharacters = triggerCharacters ?? []
    let characters = triggerCharacters.reduce((p, c) => p.concat(c.length == 1 ? [c] : c.split(/\s*/g)), [] as string[])
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      triggerCharacters: characters
    })
  }

  public shouldTrigger(document: TextDocument, triggerCharacter: string): boolean {
    let item = this.getProvider(document)
    if (!item) return false
    let { triggerCharacters } = item
    return triggerCharacters && triggerCharacters.includes(triggerCharacter)
  }

  public async provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: SignatureHelpContext
  ): Promise<SignatureHelp | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let res = await Promise.resolve(item.provider.provideSignatureHelp(document, position, token, context))
    if (res && res.signatures && res.signatures.length) return res
    return null
  }
}
