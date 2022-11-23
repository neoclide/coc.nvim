'use strict'
import { CancellationToken, Disposable } from '../../util/protocol'
import BufferSync from '../../model/bufferSync'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource } from '../types'
import { waitImmediate } from '../../util'
import { KeywordsBuffer } from '../keywords'
import Source from '../source'

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

export function register(sourceMap: Map<string, ISource>, keywords: BufferSync<KeywordsBuffer>): Disposable {
  let source = new Around(keywords)
  sourceMap.set('around', source)
  return Disposable.create(() => {
    sourceMap.delete('around')
    source.dispose()
  })
}
