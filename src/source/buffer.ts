import {Neovim} from 'neovim'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig} from '../types'
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
    if (!this.checkFileType(opt.filetype)) return false
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
