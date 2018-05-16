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
  // unique characters in result
  public chars:string[]

  constructor() {
    this.complete = null
    this.recentScores = {}
    this.chars = []
  }

  public addRecent(word: string):void {
    if (!word.length) return
    let val = this.recentScores[word]
    if (!val) {
      this.recentScores[word] = 0.05
    } else {
      this.recentScores[word] = Math.max(val + 0.05, 0.2)
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

  public async getSource(nvim:Neovim, name:string):Promise<Source | null> {
    if (natives.has(name)) return await natives.getSource(nvim, name)
    if (remotes.has(name)) return await remotes.getSource(nvim, name)
    return null
  }

  public reset():void {
    this.complete = null
    this.chars = []
  }

  public calculateChars():void {
    let {results} = this.complete
    if (!results.length) return
    let chars = []
    for (let res of results) {
      let {items} = res
      if (!items) break
      for (let item of items) {
        let word = item.abbr ? item.abbr : item.word
        for (let ch of word) {
          if (chars.indexOf(ch) == -1) {
            chars.push(ch)
          }
        }

      }
    }
    this.chars = chars
  }
}

export default new Completes()
