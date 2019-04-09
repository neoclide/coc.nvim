import { CancellationToken, Disposable, DocumentSelector, Position, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import { isWord } from '../util/string'
import workspace from '../workspace'
import { OnTypeFormattingEditProvider } from './index'
const logger = require('../util/logger')('onTypeFormatManager')

export interface ProviderItem {
  triggerCharacters: string[]
  selector: DocumentSelector
  provider: OnTypeFormattingEditProvider
}

export default class OnTypeFormatManager implements Disposable {
  private providers: Set<ProviderItem> = new Set()

  public register(selector: DocumentSelector, provider: OnTypeFormattingEditProvider, triggerCharacters: string[]): Disposable {
    let item: ProviderItem = {
      triggerCharacters,
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public getProvider(document: TextDocument, triggerCharacter: string): OnTypeFormattingEditProvider | null {
    for (let o of this.providers) {
      let { triggerCharacters, selector } = o
      if (workspace.match(selector, document) > 0 && triggerCharacters.indexOf(triggerCharacter) > -1) {
        return o.provider
      }
    }
    return null
  }

  public async onCharacterType(character: string, document: TextDocument, position: Position, token: CancellationToken): Promise<TextEdit[] | null> {
    if (isWord(character)) return
    let provider = this.getProvider(document, character)
    if (!provider) return
    let formatOpts = await workspace.getFormatOptions(document.uri)
    return await Promise.resolve(provider.provideOnTypeFormattingEdits(document, position, character, formatOpts, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
