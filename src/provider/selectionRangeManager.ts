'use strict'
import { SelectionRange, CancellationToken, Disposable, DocumentSelector, Position } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { SelectionRangeProvider } from './index'
import Manager from './manager'
import { v4 as uuid } from 'uuid'

export default class SelectionRangeManager extends Manager<SelectionRangeProvider>  {

  public register(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
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
    let ranges: SelectionRange[] = await Promise.resolve(provider.provideSelectionRanges(document, positions, token))
    if (!ranges || ranges.length == 0) return []
    for (let i = 0; i < ranges.length - 1; i++) {
      let r = ranges[i]
      if (!r.parent) r.parent = ranges[i + 1]
    }
    return ranges
  }
}
