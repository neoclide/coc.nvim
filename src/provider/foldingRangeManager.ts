'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { FoldingRange } from 'vscode-languageserver-types'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, FoldingContext, FoldingRangeProvider } from './index'
import Manager from './manager'

export default class FoldingRangeManager extends Manager<FoldingRangeProvider>  {

  public register(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are asked in
   * parallel and the results are merged.
   * If multiple folding ranges start at the same position, only the range of the first registered provider is used.
   * If a folding range overlaps with an other range that has a smaller position, it is also ignored.
   */
  public async provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | null> {
    let items = this.getProviders(document)
    let ranges: FoldingRange[] = []
    let results = await Promise.allSettled(items.map(item => {
      return Promise.resolve(item.provider.provideFoldingRanges(document, context, token)).then(res => {
        if (Array.isArray(res) && res.length > 0) {
          if (ranges.length == 0) {
            ranges.push(...res)
          } else {
            for (let r of res) {
              let sp = getParent(r.startLine, ranges)
              if (sp?.startLine === r.startLine) continue
              let ep = getParent(r.endLine, ranges)
              if (sp === ep) {
                ranges.push(r)
              }
            }
          }
          ranges.sort((a, b) => a.startLine - b.startLine)
        }
      })
    }))
    this.handleResults(results, 'provideFoldingRanges')
    return ranges
  }
}

function getParent(line: number, sortedRanges: FoldingRange[]): FoldingRange | undefined {
  for (let r of sortedRanges) {
    if (line >= r.startLine) {
      if (line <= r.endLine) {
        return r
      } else {
        continue
      }
    } else {
      break
    }
  }
  return undefined
}
