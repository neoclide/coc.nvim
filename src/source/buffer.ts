import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import buffers from '../buffers'

export default class Buffer extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'buffer',
      priority: 1,
      shortcut: 'B',
      filter: 'remote',
    })
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr, input} = opt
    let words = buffers.getWords(bufnr, input)
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
