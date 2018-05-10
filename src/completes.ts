import { Neovim } from 'neovim'
import {getConfig} from './config'
import Source from './model/source'
import Complete from './model/complete'
import {CompleteOption, VimCompleteItem} from './types'
import {logger} from './util/logger'
import natives from './natives'
import remotes from './remotes'

export class Completes {
  public complete: Complete | null
  public firstItem: VimCompleteItem | null

  constructor() {
    this.complete = null
  }

  public newComplete(opts: CompleteOption): Complete {
    let complete = new Complete(opts)
    return complete
  }

  public createComplete(opts: CompleteOption): Complete {
    let complete = this.newComplete(opts)
    this.complete = complete
    return complete
  }

  public async getSources(nvim:Neovim, filetype: string): Promise<Source[]> {
    let source_names: string[] = getConfig('sources')
    let disabled = getConfig('disabled')
    let nativeNames = natives.names
    logger.debug(`Disabled sources:${disabled}`)
    let names = nativeNames.concat(remotes.names)
    names = names.filter(n => disabled.indexOf(n) === -1)
    let res: Source[] = await Promise.all(names.map(name => {
      if (nativeNames.indexOf(name) !== -1) {
        return natives.getSource(nvim, name)
      }
      return remotes.getSource(nvim, name)
    }))
    res = res.filter(o => o != null)
    logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`)
    return res
  }

  public reset():void {
    this.complete = null
    this.firstItem = null
  }
}

export default new Completes()
