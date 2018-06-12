import {score} from 'fuzzaldrin'
import {
  CompleteOption,
  VimCompleteItem,
  RecentScore,
  ISource,
  CompleteResult} from '../types'
import {getConfig} from '../config'
import {uniqueItems} from '../util/unique'
import {byteSlice} from '../util/string'
import {
  getCharCodes,
  fuzzyMatch
} from '../util/fuzzy'
import Serial = require('node-serial')
const logger = require('../util/logger')('model-complete')

const MAX_ITEM_COUNT = 300

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public option: CompleteOption
  public startcol?: number
  public readonly recentScores: RecentScore
  constructor(opts: CompleteOption, recentScores: RecentScore |null) {
    this.option = opts
    Object.defineProperty(this, 'recentScores', {
      get: (): RecentScore => {
        return recentScores || {}
      }
    })
  }

  private completeSource(source: ISource): Promise<any> {
    let start = Date.now()
    let s = new Serial()
    let {col} = this.option
    // new option for each source
    let option = Object.assign({}, this.option)
    s.timeout(Math.max(getConfig('timeout'), 300))
    s.add((done, ctx) => {
      if (typeof source.shouldComplete === 'function') {
        source.shouldComplete(option).then(res => {
          ctx.shouldRun = res
          done()
        }, done)
      } else {
        ctx.shouldRun = true
        done()
      }
    })
    s.add((done, ctx) => {
      if (!ctx.shouldRun) {
        logger.debug(`Source ${source.name} skipped`)
        return done()
      }
      source.doComplete(option).then(result => {
        if (result == null) {
          result = {items: []}
        }
        if (result.startcol && result.startcol != col) {
          result.engross = true
        }
        result.priority = source.priority
        result.source = source.name
        ctx.result = result
        done()
      }, done)
    })
    return new Promise(resolve => {
      s.done((err, ctx) => {
        if (err) {
          logger.error(`Complete error of source '${source.name}'`)
          logger.error(err.stack)
          resolve(false)
          return
        }
        if (ctx.result) {
          logger.info(`Complete '${source.name}' takes ${Date.now() - start}ms`)
        }
        resolve(ctx.result || null)
      })
    })
  }

  private checkResult(result:CompleteResult, opt:CompleteOption):boolean {
    let {items, startcol} = result
    if (!items || items.length == 0) return false
    let {line, colnr, col, input} = opt
    if (startcol && startcol != col) {
      input = byteSlice(line, startcol, colnr - 1)
    }
    let codes = getCharCodes(input)
    return items.some(item => {
      let s = item.filterText || item.word
      return fuzzyMatch(codes, s)
    })
  }

  public filterResults(results:CompleteResult[], isIncrement = false):VimCompleteItem[] {
    let arr: VimCompleteItem[] = []
    let {input, id} = this.option
    let codes = getCharCodes(input)
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let {items, source} = res
      for (let item of items) {
        let {user_data, filterText} = item
        filterText = filterText || item.word
        if (isIncrement && item.sortText) delete item.sortText
        let data = {} as any
        if (user_data) {
          try {
            data = JSON.parse(user_data)
            filterText = data.filter ? data.filter : filterText
          } catch (e) {} // tslint:disable-line
        }
        if (input.length && !fuzzyMatch(codes, filterText)) continue
        if (!isIncrement) {
          data = Object.assign(data, { cid: id, source })
          item.user_data = JSON.stringify(data)
        }
        item.score = score(filterText, input) + this.getBonusScore(input, item)
        arr.push(item)
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      if (sa && sb) {
        if (sa === sb) return b.score - a.score
        return sa > sb ? 1 : -1
      } else {
        return b.score - a.score
      }
    })
    arr = arr.slice(0, MAX_ITEM_COUNT)
    return uniqueItems(arr)
  }

  public async doComplete(sources: ISource[]): Promise<[number, VimCompleteItem[]]> {
    let opts = this.option
    let {col, line, colnr} = opts
    sources.sort((a, b) => b.priority - a.priority)
    let results = await Promise.all(sources.map(s => this.completeSource(s)))
    results = results.filter(r => {
      // error source
      if (r ===false) return false
      if (r == null) return false
      return this.checkResult(r, opts)
    })

    logger.debug(`Results from sources: ${results.map(s => s.source).join(',')}`)
    if (results.length == 0) return [col, []]
    let engrossResult = results.find(r => r.engross === true)
    if (engrossResult) {
      let {startcol} = engrossResult
      if (startcol && startcol != col) {
        col = engrossResult.startcol
        opts.col = col
        opts.input = byteSlice(line, startcol, colnr - 1)
      }
      results = [engrossResult]
      logger.debug(`Engross source ${engrossResult.source} activted`)
    }
    let priority = results[0].priority
    results = results.filter(r => r.priority === priority)
    this.results = results
    this.startcol = col
    let filteredResults = this.filterResults(results)
    logger.debug(`Filtered items: ${JSON.stringify(filteredResults, null, 2)}`)
    return [col, filteredResults]
  }

  private getBonusScore(input:string, item: VimCompleteItem):number {
    let {word, abbr, kind, info} = item
    let score = input.length
      ? this.recentScores[`${input.slice(0,1)}|${word}`] || 0
      : 0
    score += (input && word[0] == input[0]) ? 0.001 : 0
    score += kind ? 0.001 : 0
    score += abbr ? 0.001 : 0
    score += info ? 0.001 : 0
    return score
  }
}
