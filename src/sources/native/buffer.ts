import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import BufferSync from '../../model/bufferSync'
import { CompleteOption, CompleteResult, ISource } from '../../types'
import { waitImmediate } from '../../util'
import { fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import KeywordsBuffer from '../keywords'
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

  private async getWords(bufnr: number, opt: CompleteOption, token: CancellationToken): Promise<string[]> {
    let { ignoreGitignore } = this
    let words: Set<string> = new Set()
    // let ignored: Set<string> = curr ? curr.words : new Set()
    let first = opt.input[0]
    let fuzzy = first.length > 1
    let min = opt.input.length
    let code = first.charCodeAt(0)
    let ignoreCase = code >= 97 && code <= 122
    let needle = fuzzy ? getCharCodes(opt.input) : []
    let ts = Date.now()
    for (let item of this.keywords.items) {
      if (item.bufnr === bufnr) continue
      if (ignoreGitignore && item.gitIgnored) continue
      if (Date.now() - ts > 15) {
        await waitImmediate()
        if (token.isCancellationRequested) return undefined
        ts = Date.now()
      }
      for (let w of item.words) {
        if (w.length < min) continue
        let ch = ignoreCase ? w[0].toLowerCase() : w[0]
        if (fuzzy) {
          if (fuzzyMatch(needle, w)) words.add(w)
        } else {
          if (ch === first) words.add(w)
        }
      }
    }
    return Array.from(words)
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult> {
    let { bufnr, input } = opt
    if (input.length == 0) return null
    await waitImmediate()
    let words = await this.getWords(bufnr, opt, token)
    return {
      items: words.map(word => ({
        word,
        menu: this.menu
      }))
    }
  }
}

export function regist(sourceMap: Map<string, ISource>, keywords: BufferSync<KeywordsBuffer>): Disposable {
  sourceMap.set('buffer', new Buffer(keywords))
  return Disposable.create(() => {
    sourceMap.delete('buffer')
  })
}
