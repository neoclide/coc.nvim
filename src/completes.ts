import { Neovim } from 'neovim'
import {getConfig} from './config'
import Source from './model/source'
import Complete from './model/complete'
import {CompleteOptionVim} from './types'
import {logger} from './util/logger'
import natives from './natives'
import remotes from './remotes'

export class Completes {
  public complete: Complete | null

  constructor() {
    this.complete = null
  }

  public newComplete(opts: CompleteOptionVim): Complete {
    let {bufnr, lnum, line, col, colnr, input, filetype, word} = opts
    let complete = new Complete({
      bufnr: bufnr.toString(),
      linenr: lnum,
      line,
      word,
      col,
      colnr,
      input,
      filetype
    })
    return complete
  }

  public createComplete(opts: CompleteOptionVim): Complete {
    let complete = this.newComplete(opts)
    this.complete = complete
    return complete
  }

  public getComplete(opts: CompleteOptionVim): Complete | null {
    if (!this.complete) return null
    let complete = this.newComplete(opts)
    return this.complete.resuable(complete) ? this.complete: null
  }

  public async getSources(nvim:Neovim, filetype: string): Promise<Source[]> {
    let source_names: string[] = getConfig('sources')
    let res: Source[] = []
    for (let name of source_names) {
      let source: Source | null
      if (natives.has(name)) {
        source = await natives.getSource(nvim, name)
      } else if (remotes.has(name)) {
        source = await remotes.getSource(nvim, name)
      } else {
        logger.error(`Source ${name} not found`)
      }
      if (source) {
        res.push(source)
      } else {
        logger.error(`Source ${name} can not created`)
      }
    }
    logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`)
    return res
  }
}

export default new Completes()
