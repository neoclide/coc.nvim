import {Neovim} from '@chemzqm/neovim'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig, ISource} from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('source-buffer')

export default class Buffer extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'buffer',
      ...opts
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async refresh(): Promise<void> {
    await workspace.refresh()
  }

  private getWords(bufnr: number): string[] {
    let {ignoreGitignore} = this.config
    let words: string[] = []
    workspace.documents.forEach(document => {
      if (!document || (ignoreGitignore && document.isIgnored)) return
      if (document.bufnr == bufnr) return
      for (let word of document.words) {
        if (words.indexOf(word) == -1) {
          words.push(word)
        }
      }
    })
    return words
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr} = opt
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

export function regist(sourceMap:Map<string, ISource>):void {
  let {nvim} = workspace
  let config = workspace.getConfiguration('coc.source').get<SourceConfig>('buffer')
  sourceMap.set('buffer', new Buffer(nvim, config))
}
