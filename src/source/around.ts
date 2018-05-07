import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import {logger} from '../util/logger'
import buffers from '../buffers'

export default class Around extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'around',
      shortcut: 'A'
    })
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr, input, filetype} = opt
    let filepath = await this.nvim.call('expand', ['%:p'])
    let uri = `file://${filepath}`
    let buffer = await this.nvim.buffer
    let keywordOption = await buffer.getOption('iskeyword')
    let lines = await buffer.lines
    let content = (lines as string[]).join('\n')
    let document = buffers.createDocument(uri, filetype, content, keywordOption)
    let words = document.getWords()
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
