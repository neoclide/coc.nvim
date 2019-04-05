import { CancellationToken, Disposable, DocumentSelector, Position, SignatureHelp, TextDocument } from 'vscode-languageserver-protocol'
import { SignatureHelpProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class SignatureManager extends Manager<SignatureHelpProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: SignatureHelpProvider, triggerCharacters?: string[]): Disposable {
    let characters = triggerCharacters.reduce((p, c) => {
      return p.concat(c.split(/\s*/g))
    }, [] as string[])
    let item: ProviderItem<SignatureHelpProvider> = {
      id: uuid(),
      selector,
      provider,
      triggerCharacters: characters
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public shouldTrigger(document: TextDocument, triggerCharacter: string): boolean {
    let item = this.getProvider(document)
    if (!item) return false
    let { triggerCharacters } = item
    return triggerCharacters && triggerCharacters.indexOf(triggerCharacter) != -1
  }

  public async provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<SignatureHelp | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let res = await Promise.resolve(item.provider.provideSignatureHelp(document, position, token))
    if (res && res.signatures && res.signatures.length) return res
    return null
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
