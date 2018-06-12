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
  private charCodes:Set<number> = new Set()

  constructor() {
    this.complete = null
    this.recentScores = {}
  }

  public addRecent(word: string):void {
    if (!word.length) return
    let {input} = this.option
    if (!input.length) return
    let key = `${input.slice(0,1)}|${word}`
    let val = this.recentScores[key]
    if (!val) {
      this.recentScores[key] = 0.01
    } else {
      this.recentScores[key] = Math.min(val + 0.01, 0.1)
    }
  }

  public createComplete(opts: CompleteOption, isIncrement?:boolean): Complete {
    let complete = new Complete(opts, this.recentScores)
    // initailize complete
    if (!isIncrement) {
      this.complete = complete
    }
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
  public async getSources(nvim:Neovim, opt: CompleteOption): Promise<ISource[]> {
    let disabled = getConfig('disabled')
    let {filetype, triggerCharacter} = opt
    let languageSource = languages.getCompleteSource(filetype)
    let nativeNames = natives.getSourceNamesOfFiletype(filetype)
    logger.debug(`Disabled sources:${disabled}`)
    let names = nativeNames.concat(remotes.names)
    names = names.filter(n => disabled.indexOf(n) === -1)
    let res: ISource[] = await Promise.all(names.map(name => {
      if (nativeNames.indexOf(name) !== -1) {
        return natives.getSource(nvim, name)
      }
      return remotes.getSource(nvim, name)
    }))
    res.push(languageSource)
    res = res.filter(o => {
      if (o == null) return false
      if (triggerCharacter && !o.shouldTriggerCompletion(triggerCharacter, filetype)) {
        return false
      }
      return true
    })
    logger.debug(`Activted sources: ${res.map(o => o.name).join(',')}`)
    return res
  }

  public shouldTriggerCompletion(character:string, languageId: string):boolean {
    // TODO rework natives remotes
    return false
  }

  public async getSource(nvim:Neovim, name:string):Promise<ISource | null> {
    if (natives.has(name)) return await natives.getSource(nvim, name)
    if (remotes.has(name)) return await remotes.getSource(nvim, name)
    return null
  }

  public reset():void {
    this.charCodes = new Set()
  }

  public calculateChars(items:VimCompleteItem[]):void {
    let {charCodes} = this
    for (let item of items) {
      let s = item.filterText || item.word
      for (let i = 0, l = s.length; i < l; i++) {
        let code = s.charCodeAt(i)
        // not supported for filter
        if (code > 256) continue
        charCodes.add(code)
        if (code >= 65 && code <= 90) {
          charCodes.add(code + 32)
        }
      }
    }
  }

  public hasCharacter(ch:string):boolean {
    let code = ch.charCodeAt(0)
    return this.charCodes.has(code)
  }

  public get option():CompleteOption|null {
    let {complete} = this
    if (!complete) return null
    return complete.option
  }
}

export default new Completes()
