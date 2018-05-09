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
    let disabled = getConfig('disabled')
    let res: Source[] = []
    let names = natives.names
    logger.debug(`Disabled sources:${disabled}`)
    names = names.concat(remotes.names)
    for (let name of names) {
      let source: any
      if (disabled.indexOf(name) !== -1) continue
      try {
        if (natives.has(name)) {
          source = await natives.getSource(nvim, name)
        } else {
          source = await remotes.getSource(nvim, name)
        }
      } catch (e) {
        logger.error(`Source ${name} can not be created`)
      }
      res.push(source)
    }
    logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`)
    return res
  }

  public reset():void {
    this.complete = null
  }
}

export default new Completes()
