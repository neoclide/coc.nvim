import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import buffers from '../buffers'
const logger = require('../util/logger')('source-around')

export default class Around extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'around',
      shortcut: 'A',
      priority: 2,
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr, input, filetype} = opt
    let uri = `buffer://${bufnr}`
    let buffer = await this.nvim.buffer
    let keywordOption = await buffer.getOption('iskeyword')
    let lines = await buffer.lines
    let content = lines.join('\n')
    let document = buffers.createDocument(uri, filetype, content, keywordOption as string)
    let words = document.getWords()
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
