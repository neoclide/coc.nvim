'use strict'
import BufferSync from '../../model/bufferSync'
import { waitImmediate } from '../../util'
import { CancellationToken } from '../../util/protocol'
import { KeywordsBuffer } from '../keywords'
import Source from '../source'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource } from '../types'

export class Around extends Source {
  constructor(private keywords: BufferSync<KeywordsBuffer>) {
    super({ name: 'around', filepath: __filename })
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult<ExtendedCompleteItem>> {
    let { bufnr, input, word, linenr, triggerForInComplete } = opt
    let buf = this.keywords.getItem(bufnr)
    await waitImmediate()
    if (!triggerForInComplete) this.noMatchWords = new Set()
    if (input.length === 0 || !buf || token.isCancellationRequested) return null
    let iterable = buf.matchWords(linenr - 1)
    let items: Set<string> = new Set()
    let isIncomplete = await this.getResults([iterable], input, word, items, token)
    return {
      isIncomplete, items: Array.from(items).map(s => {
        return { word: s }
      })
    }
  }
}

export function register(sourceMap: Map<string, ISource>, keywords: BufferSync<KeywordsBuffer>): void {
  let source = new Around(keywords)
  sourceMap.set('around', source)
}
