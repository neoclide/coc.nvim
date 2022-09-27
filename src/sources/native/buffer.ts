'use strict'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import BufferSync from '../../model/bufferSync'
import { CompleteOption, CompleteResult, ISource, VimCompleteItem } from '../../types'
import { waitImmediate } from '../../util'
import { KeywordsBuffer } from '../keywords'
import Source from '../source'
const logger = require('../../util/logger')('sources-buffer')

export default class Buffer extends Source {
  constructor(private keywords: BufferSync<KeywordsBuffer>) {
    super({
      name: 'buffer',
      filepath: __filename
    })
  }

  public get ignoreGitignore(): boolean {
    return this.getConfig('ignoreGitignore', true)
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult> {
    let { bufnr, input, word } = opt
    await waitImmediate()
    if (input.length === 0 || token.isCancellationRequested) return null
    let { menu } = this
    let isIncomplete = false
    let start = Date.now()
    let prev = start
    let words: Set<string> = new Set()
    let items: VimCompleteItem[] = []
    for (let buf of this.keywords.items) {
      if (buf.bufnr === bufnr || (this.ignoreGitignore && buf.gitIgnored)) continue
      let iterable = buf.matchWords(0, input, true)
      for (let w of iterable) {
        let curr = Date.now()
        if (token.isCancellationRequested) return null
        if (curr - prev > 15) {
          await waitImmediate()
          prev = curr
        }
        if (curr - start > 80 || words.size > 100) {
          isIncomplete = true
          break
        }
        if (w == word || words.has(w)) continue
        words.add(w)
        items.push({ word: w, menu })
      }
      if (isIncomplete) break
    }
    return { isIncomplete, items }
  }
}

export function register(sourceMap: Map<string, ISource>, keywords: BufferSync<KeywordsBuffer>): Disposable {
  sourceMap.set('buffer', new Buffer(keywords))
  return Disposable.create(() => {
    sourceMap.delete('buffer')
  })
}
