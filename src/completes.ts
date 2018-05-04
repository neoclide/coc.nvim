import { Neovim } from 'neovim'
import {getConfig} from './config'
import Source from './model/source'
import Complete from './model/complete'
import {CompleteOptionVim} from './types'
import {logger} from './util/logger'
import natives from './natives'
import remotes from './remotes'

export class Completes {
  public completes: Complete[]

  constructor() {
    this.completes = []
  }
  public createComplete(opts: CompleteOptionVim): Complete {
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
  // should be called when sources changed
  public reset():void {
    this.completes = []
  }
}

export default new Completes()
