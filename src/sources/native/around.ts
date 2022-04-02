import { Disposable } from 'vscode-languageserver-protocol'
import BufferSync from '../../model/bufferSync'
import { CompleteOption, CompleteResult, ISource } from '../../types'
import { waitImmediate } from '../../util'
import { fuzzyMatch, getCharCodes } from '../../util/fuzzy'
import KeywordsBuffer from '../keywords'
import Source from '../source'
const logger = require('../../util/logger')('sources-around')

export default class Around extends Source {
  constructor(private keywords: BufferSync<KeywordsBuffer>) {
    super({
      name: 'around',
      filepath: __filename
    })
  }

  /**
   * Filter words that too short or doesn't match input
   */
  private filterWords(words: Set<string>, opt: CompleteOption): string[] {
    let res = []
    let { input } = opt
    let cword = opt.word
    let first = input[0]
    let fuzzy = first.length > 1
    let min = opt.input.length
    let code = first.charCodeAt(0)
    let ignoreCase = code >= 97 && code <= 122
    let needle = fuzzy ? getCharCodes(input) : []
    let checkInput = true
    let checkCword = true
    for (let word of words) {
      let len = word.length
      if (len < min) continue
      if (checkInput && len == min && word === input) {
        checkInput = false
        continue
      }
      if (checkCword && len == cword.length && word === cword) {
        checkCword = false
        continue
      }
      let ch = ignoreCase ? word[0].toLowerCase() : word[0]
      if (fuzzy) {
        if (fuzzyMatch(needle, word)) res.push(word)
      } else {
        if (ch === first) res.push(word)
      }
    }
    return res
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { bufnr, input } = opt
    await waitImmediate()
    let item = this.keywords.getItem(bufnr)
    let words = item?.words
    if (!words || input.length === 0) return null
    let arr = this.filterWords(words, opt)
    return {
      items: arr.map(word => ({
        word,
        menu: this.menu
      }))
    }
  }
}

export function regist(sourceMap: Map<string, ISource>, keywords: BufferSync<KeywordsBuffer>): Disposable {
  sourceMap.set('around', new Around(keywords))
  return Disposable.create(() => {
    sourceMap.delete('around')
  })
}
