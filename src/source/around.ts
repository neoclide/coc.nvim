import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import Buffer from '../model/buffer'
import buffers from '../buffers'
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
    let {bufnr, filetype} = opt
    let {nvim} = this
    let count:number = await nvim.call('nvim_buf_line_count', [bufnr])
    let keywordOption:string = await nvim.call('getbufvar', [bufnr, '&iskeyword'])
    let words = buffers.document.getWords()
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
