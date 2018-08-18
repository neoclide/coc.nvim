import { CancellationToken, Disposable, Position, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import { isWord } from '../util/string'
import workspace from '../workspace'
import { OnTypeFormattingEditProvider } from './index'

export interface ProviderItem {
  triggerCharacters: string[]
  provider: OnTypeFormattingEditProvider
}

export default class OnTypeFormatManager implements Disposable {
  private providers: Map<string, ProviderItem> = new Map()

  public register(languageIds: string[], provider: OnTypeFormattingEditProvider, triggerCharacters: string[]): Disposable {
    for (let languageId of languageIds) {
      this.providers.set(languageId, {
        triggerCharacters,
        provider
      })
    }
    return Disposable.create(() => {
      for (let languageId of languageIds) {
        let item = this.providers.get(languageId)
        if (item.provider == provider) {
          this.providers.delete(languageId)
        }
      }
    })
  }

  private getProvider(languageId: string, triggerCharacter: string): OnTypeFormattingEditProvider | null {
    let item = this.providers.get(languageId)
    if (!item) return null
    let { triggerCharacters, provider } = item
    if (triggerCharacters.indexOf(triggerCharacter) == -1) return null
    return provider
  }

  public async onCharacterType(character: string, document: TextDocument, position: Position, token: CancellationToken): Promise<TextEdit[] | null> {
    if (isWord(character)) return
    let { languageId } = document
    let provider = this.getProvider(languageId, character)
    if (!provider) return
    let formatOpts = await workspace.getFormatOptions()
    return await Promise.resolve(provider.provideOnTypeFormattingEdits(document, position, character, formatOpts, token))
  }

  public dispose(): void {
    this.providers = new Map()
  }
}
