import {Neovim} from 'neovim'
import {getConfig} from './config'
import Complete from './model/complete'
import {
  CompleteOption,
  VimCompleteItem,
  ISource,
  RecentScore} from './types'
import languages from './languages'
import natives from './natives'
import remotes from './remotes'
const logger = require('./util/logger')('completes')

export class Completes {
  public complete: Complete | null
  public recentScores: RecentScore
  // unique charactor code in result
  private charCodes:number[]

  constructor() {
    this.complete = null
    this.recentScores = {}
    this.charCodes = []
  }

  public addRecent(word: string):void {
    if (!word.length) return
    let {input} = this.option
    let key = `${input.slice(0,3)}|${word}`
    let val = this.recentScores[key]
    if (!val) {
      this.recentScores[key] = 0.1
    } else {
      this.recentScores[key] = Math.max(val + 0.1, 0.3)
    }
  }

  public newComplete(opts: CompleteOption): Complete {
    let complete = new Complete(opts)
    complete.recentScores = this.recentScores
    return complete
  }

  // complete on start
  public createComplete(opts: CompleteOption): Complete {
    let complete = this.newComplete(opts)
    this.complete = complete
    return complete
  }

  /**
   * Get all sources for languageId
   *
   * @public
   * @param {Neovim} nvim
   * @param {string} languageId
   * @returns {Promise<ISource[]>}
   */
  public async getSources(nvim:Neovim, languageId: string): Promise<ISource[]> {
    let disabled = getConfig('disabled')
    let nativeNames = natives.getSourceNamesOfFiletype(languageId)
    logger.debug(`Disabled sources:${disabled}`)
    let names = nativeNames.concat(remotes.names)
    names = names.filter(n => disabled.indexOf(n) === -1)
    let res: ISource[] = await Promise.all(names.map(name => {
      if (nativeNames.indexOf(name) !== -1) {
        return natives.getSource(nvim, name)
      }
      return remotes.getSource(nvim, name)
    }))
    res.push(languages.getCompleteSource(languageId))
    res = res.filter(o => o != null)
    logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`)
    return res
  }

  public async getSource(nvim:Neovim, name:string):Promise<ISource | null> {
    if (natives.has(name)) return await natives.getSource(nvim, name)
    if (remotes.has(name)) return await remotes.getSource(nvim, name)
    return null
  }

  public reset():void {
    this.charCodes = []
  }

  public calculateChars(items:VimCompleteItem[]):void {
    let res = []
    if (!this.complete) return
    for (let item of items) {
      let user_data = JSON.parse(item.user_data)
      let s = user_data.filter == 'abbr' ? item.abbr : item.word
      for (let i = 0, l = s.length; i < l; i++) {
        let code = s.charCodeAt(i)
        // not supported for filter
        if (code > 256) continue
        if (res.indexOf(code) === -1) {
          res.push(code)
        }
        if (code >= 65 && code <= 90 && res.indexOf(code + 32) === -1) {
          res.push(code + 32)
        }
      }
    }
    this.charCodes = res
  }

  public hasCharacter(ch:string):boolean {
    let code = ch.charCodeAt(0)
    return this.charCodes.indexOf(code) !== -1
  }

  public get option():CompleteOption|null {
    let {complete} = this
    if (!complete) return null
    return complete.option
  }
}

export default new Completes()
