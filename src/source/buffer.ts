import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('source-buffer')

export default class Buffer extends Source {
  constructor() {
    super({
      name: 'buffer',
      filepath: __filename
    })
  }

  public get ignoreGitignore(): boolean {
    return this.getConfig('ignoreGitignore', true)
  }

  private getWords(bufnr: number): string[] {
    let { ignoreGitignore } = this
    let words: string[] = []
    workspace.documents.forEach(document => {
      if (document.bufnr == bufnr) return
      if (ignoreGitignore && document.isIgnored) return
      for (let word of document.words) {
        if (words.indexOf(word) == -1) {
          words.push(word)
        }
      }
    })
    return words
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { bufnr, input } = opt
    if (input.length == 0) return null
    let words = this.getWords(bufnr)
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
  sourceMap.set('buffer', new Buffer())
  return Disposable.create(() => {
    sourceMap.delete('buffer')
  })
}
