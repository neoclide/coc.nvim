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

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let { input } = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { bufnr } = opt
    let document = workspace.getDocument(bufnr)
    if (!document) return
    let words = document!.words
    let moreWords = document!.getMoreWords()
    words.push(...moreWords)
    words = this.filterWords(words, opt)
    return {
      items: words.map(word => {
        return {
          word,
          menu: this.menu
        }
      })
    }
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('around', new Around())
  return Disposable.create(() => {
    sourceMap.delete('around')
  })
}
