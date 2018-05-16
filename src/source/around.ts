import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import buffers from '../buffers'
import {echoWarning} from '../util/index'
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
    let uri = `buffer://${bufnr}`
    let {nvim} = this
    let count:number = await nvim.call('nvim_buf_line_count', [bufnr])
    if (count > 2000) {
      await echoWarning(nvim, `File too big, loading file from disk`)
    }
    let keywordOption = await nvim.call('getbufvar', [bufnr, '&iskeyword'])
    let content = await buffers.loadBufferContent(nvim, bufnr, 300)
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
