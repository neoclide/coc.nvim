'use strict'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import BufferSync from '../../model/bufferSync'
import { CompleteOption, CompleteResult, ISource, VimCompleteItem } from '../../types'
import { waitImmediate } from '../../util'
import { KeywordsBuffer } from '../keywords'
import Source from '../source'
const logger = require('../../util/logger')('sources-around')

export default class Around extends Source {
  constructor(private keywords: BufferSync<KeywordsBuffer>) {
    super({
      name: 'around',
      filepath: __filename
    })
  }

  public async getResults(iterable: Iterable<string>, exclude: string, items: VimCompleteItem[], token: CancellationToken): Promise<boolean> {
    let { menu } = this
    let start = Date.now()
    let prev = start
    for (let w of iterable) {
      let curr = Date.now()
      if (token.isCancellationRequested) return true
      if (curr - prev > 15) {
        await waitImmediate()
        prev = curr
      }
      if (curr - start > 80) return true
      if (w == exclude) continue
      items.push({ word: w, menu })
    }
    return false
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult> {
    let { bufnr, input, word, linenr } = opt
    await waitImmediate()
    let buf = this.keywords.getItem(bufnr)
    if (input.length === 0 || !buf || token.isCancellationRequested) return null
    let iterable = buf.matchWords(linenr - 1, input, true)
    let items: VimCompleteItem[] = []
    let isIncomplete = await this.getResults(iterable, word, items, token)
    return { isIncomplete, items }
  }
}

export function register(sourceMap: Map<string, ISource>, keywords: BufferSync<KeywordsBuffer>): Disposable {
  sourceMap.set('around', new Around(keywords))
  return Disposable.create(() => {
    sourceMap.delete('around')
  })
}
