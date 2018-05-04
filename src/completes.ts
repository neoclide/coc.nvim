import { Neovim } from 'neovim'
import {getConfig} from './config'
import Source from './model/source'
import Complete from './model/complete'
import {CompleteOptionVim} from './types'
import BufferSource from './source/buffer'
import {logger} from './util/logger'

// TODO add dictionary & path

export class Completes {
  public completes: Complete[]

  constructor() {
    this.completes = []
  }
  public createComplete(opts: CompleteOptionVim): Complete {
    // let {bufnr, line, col, input, filetype} = opts
    let {bufnr, lnum, col, input, filetype, word} = opts
    let complete = new Complete({
      bufnr: bufnr.toString(),
      line: lnum,
      word,
      col,
      input,
      filetype
    })
    let {id} = complete

    let exist = this.completes.find(o => o.id === id)

    if (exist) return exist
    if (this.completes.length > 10) {
      this.completes.shift()
    }
    this.completes.push(complete)
    return complete
  }

  public getSources(nvim:Neovim, filetype: string): Source[] {
    let sources = getConfig('sources')
    let res: Source[] = []
    for (let s of sources) {
      if (s === 'buffer') {
        res.push(new BufferSource(nvim))
      }
    }
    return res
  }
  // should be called when sources changed
  public reset():void {
    this.completes = []
  }
}

export default new Completes()
