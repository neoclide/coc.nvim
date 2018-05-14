import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import buffers from '../buffers'
// const logger = require('../util/logger')('source-buffer')

export default class Buffer extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'buffer',
      shortcut: 'B',
      priority: 1,
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async refresh():Promise<void> {
    await buffers.refresh(this.nvim)
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr} = opt
    let words = buffers.getWords(bufnr)
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
