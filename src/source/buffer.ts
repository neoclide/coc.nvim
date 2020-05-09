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
        if (!words.includes(word)) {
          words.push(word)
        }
      }
    })
    return words
  }

  public doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { bufnr, input } = opt
    if (input.length == 0) return null
    let words = this.getWords(bufnr)
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
  sourceMap.set('buffer', new Buffer())
  return Disposable.create(() => {
    sourceMap.delete('buffer')
  })
}
