import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('source-around')

export default class Around extends Source {
  constructor() {
    super({
      name: 'around',
      filepath: __filename
    })
  }

  public doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { bufnr, input } = opt
    if (input.length === 0) return null
    let document = workspace.getDocument(bufnr)
    if (!document) return null
    let words = document.words
    let moreWords = document.getMoreWords()
    words.push(...moreWords)
    words = this.filterWords(words, opt)
    return Promise.resolve({
      items: words.map(word => ({
        word,
        menu: this.menu
      }))
    })
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('around', new Around())
  return Disposable.create(() => {
    sourceMap.delete('around')
  })
}
