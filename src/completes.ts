import { Neovim } from 'neovim'
import {getConfig} from './config'
import Source from './model/source'
import Complete from './model/complete'
import {CompleteOption, RecentScore} from './types'
import natives from './natives'
import remotes from './remotes'
const logger = require('./util/logger')('completes')

export class Completes {
  public complete: Complete | null
  public recentScores: RecentScore

  constructor() {
    this.complete = null
    this.recentScores = {}
  }

  public addRecent(word: string):void {
    let val = this.recentScores[word]
    if (!val) {
      this.recentScores[word] = 0.01
    } else {
      this.recentScores[word] = val + 0.01
    }
  }

  public newComplete(opts: CompleteOption): Complete {
    let complete = new Complete(opts)
    complete.recentScores = this.recentScores
    return complete
  }

  public createComplete(opts: CompleteOption): Complete {
    let complete = this.newComplete(opts)
    this.complete = complete
    return complete
  }

  public async getSources(nvim:Neovim, filetype: string): Promise<Source[]> {
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
  }
}

export default new Completes()
