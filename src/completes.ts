import Complete from './model/complete'
import {
  getCharCodes,
  fuzzyMatch
} from './util/fuzzy'
import {
  CompleteOption,
  RecentScore} from './types'
const logger = require('./util/logger')('completes')

export class Completes {
  public complete: Complete | null
  public recentScores: RecentScore

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
    // noop
  }

  public get option():CompleteOption|null {
    let {complete} = this
    if (!complete) return null
    return complete.option
  }

  public hasMatch(search:string):boolean {
    let {complete} = this
    if (!complete) return false
    let {results} = complete
    let codes = getCharCodes(search)
    for (let res of results) {
      let {items} = res
      for (let o of items) {
        let s = o.filterText || o.word
        if (fuzzyMatch(codes, s)) {
          return true
        }
      }
    }
    return false
  }
}

export default new Completes()
