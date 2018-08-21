import { CancellationToken, Disposable, DocumentSelector, Position, SignatureHelp, TextDocument } from 'vscode-languageserver-protocol'
import { SignatureHelpProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class SignatureManager extends Manager<SignatureHelpProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: SignatureHelpProvider, triggerCharacters?: string[]): Disposable {
    let item: ProviderItem<SignatureHelpProvider> = {
      id: uuid(),
      selector,
      provider,
      triggerCharacters
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async shouldTrigger(document: TextDocument, triggerCharacter: string): Promise<boolean> {
    let providers = this.getProviders(document)
    if (!providers.length) return false
    return providers.some(item => {
      return Array.isArray(item.triggerCharacters) && item.triggerCharacters.indexOf(triggerCharacter) != -1
    })
  }

  public async provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): Promise<SignatureHelp | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    for (let item of providers) {
      let { provider } = item
      let res = await Promise.resolve(provider.provideSignatureHelp(document, position, token))
      if (res) return res
    }
    return null
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
