import { CompletionItemKind, Position, Range, SelectionRange } from 'vscode-languageserver-types'
import events from '../events'
import languages from '../languages'
import { CompleteOption, DurationCompleteItem } from './types'
import { binarySearch, isFalsyOrEmpty, toArray } from '../util/array'
import { equals, toObject } from '../util/object'
import * as Is from '../util/is'
import { compareRangesUsingStarts, rangeInRange } from '../util/position'
import { CancellationToken } from '../util/protocol'
import workspace from '../workspace'
import { waitWithToken } from '../util'

export abstract class WordDistance {

  public static readonly None = new class extends WordDistance {
    public distance() { return 0 }
  }()

  public static async create(localityBonus: boolean, opt: Pick<CompleteOption, 'position' | 'bufnr' | 'word' | 'linenr' | 'colnr'>, token: CancellationToken): Promise<WordDistance> {
    let { position } = opt
    let cursor: [number, number] = [opt.linenr, opt.colnr]
    if (!localityBonus) return WordDistance.None

    let doc = workspace.getDocument(opt.bufnr)
    const selectionRanges = await languages.getSelectionRanges(doc.textDocument, [position], token)
    if (!selectionRanges || token.isCancellationRequested) return WordDistance.None

    let ranges: Range[] = []
    const iterate = (r?: SelectionRange) => {
      if (r && r.range.end.line - r.range.start.line < 2000) {
        ranges.unshift(r.range)
        iterate(r.parent)
      }
    }
    iterate(toArray(selectionRanges)[0])

    let wordRanges = ranges.length > 0 ? await Promise.race([waitWithToken(100, token), workspace.computeWordRanges(opt.bufnr, ranges[0], token)]) : undefined
    if (!Is.objectLiteral(wordRanges)) return WordDistance.None

    // remove current word
    delete wordRanges[opt.word]
    return new class extends WordDistance {
      // Unlike VSCode, word insert position is used here
      public distance(anchor: Position, item: DurationCompleteItem) {
        if (!equals([events.cursor.lnum, events.cursor.col], cursor)) {
          return 0
        }
        if (item.kind === CompletionItemKind.Keyword || toObject(item.source)['name'] === 'snippets') {
          return 2 << 20
        }
        const wordLines = wordRanges[item.word]
        if (isFalsyOrEmpty(wordLines)) {
          return 2 << 20
        }
        const idx = binarySearch(wordLines, Range.create(anchor, anchor), compareRangesUsingStarts)
        const bestWordRange = idx >= 0 ? wordLines[idx] : wordLines[Math.max(0, ~idx - 1)]
        let blockDistance = ranges.length
        for (const range of ranges) {
          if (!rangeInRange(bestWordRange, range)) {
            break
          }
          blockDistance -= 1
        }
        return blockDistance
      }
    }()
  }

  public abstract distance(anchor: Position, item: DurationCompleteItem): number
}
