'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, SelectionRange } from 'vscode-languageserver-types'
import { equals } from '../util/object'
import { rangeInRange } from '../util/position'
import type { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, SelectionRangeProvider } from './index'
import Manager from './manager'

export default class SelectionRangeManager extends Manager<SelectionRangeProvider>  {

  public register(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are asked in
   * parallel and the results are merged. A failing provider (rejected promise or exception) will
   * not cause a failure of the whole operation.
   */
  public async provideSelectionRanges(
    document: TextDocument,
    positions: Position[],
    token: CancellationToken
  ): Promise<SelectionRange[] | null> {
    let items = this.getProviders(document)
    if (items.length === 0) return null
    let selectionRangeResult: SelectionRange[][] = []
    let results = await Promise.allSettled(items.map(item => {
      return Promise.resolve(item.provider.provideSelectionRanges(document, positions, token)).then(ranges => {
        if (Array.isArray(ranges) && ranges.length > 0) {
          selectionRangeResult.push(ranges)
        }
      })
    }))
    this.handleResults(results, 'provideSelectionRanges')
    if (selectionRangeResult.length === 0) return null
    let selectionRanges = selectionRangeResult[0]
    // concat ranges when possible
    if (selectionRangeResult.length > 1) {
      for (let i = 1; i <= selectionRangeResult.length - 1; i++) {
        let start = selectionRanges[0].range
        let end = selectionRanges[selectionRanges.length - 1].range
        let ranges = selectionRangeResult[i]
        let len = ranges.length
        if (rangeInRange(end, ranges[0].range) && !equals(end, ranges[0].range)) {
          selectionRanges.push(...ranges)
        } else if (rangeInRange(ranges[len - 1].range, start) && !equals(ranges[len - 1].range, start)) {
          selectionRanges.unshift(...ranges)
        }
      }
    }
    for (let i = 0; i < selectionRanges.length - 1; i++) {
      let r = selectionRanges[i]
      r.parent = selectionRanges[i + 1]
    }
    return selectionRanges
  }
}
