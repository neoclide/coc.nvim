import Complete from './model/complete'
import {
  CompleteOption,
  VimCompleteItem,
  RecentScore} from './types'
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
