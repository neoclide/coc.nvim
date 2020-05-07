import { SelectionRange, CancellationToken, Disposable, DocumentSelector, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { SelectionRangeProvider } from './index'
import Manager from './manager'
import { v4 as uuid } from 'uuid'

export default class SelectionRangeManager extends Manager<SelectionRangeProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable {
    let item = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideSelectionRanges(
    document: TextDocument,
    positions: Position[],
    token: CancellationToken
  ): Promise<SelectionRange[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return (await Promise.resolve(provider.provideSelectionRanges(document, positions, token)) || [])
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
