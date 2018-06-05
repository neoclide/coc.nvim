import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import workspace from '../workspace'
const logger = require('../util/logger')('source-around')

export default class Around extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'around',
      shortcut: 'A',
      priority: 2,
      firstMatch: true,
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr} = opt
    let document = workspace.getDocument(bufnr)
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
