import {score} from 'fuzzaldrin'
import {
  CompleteOption,
  VimCompleteItem,
  RecentScore,
  CompleteResult} from '../types'
import Source from './source'
import {getConfig} from '../config'
import {wordSortItems} from '../util/sorter'
import {uniqueItems} from '../util/unique'
import {filterWord} from '../util/index'
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
  public recentScores: RecentScore
  constructor(opts: CompleteOption) {
    this.option = opts
    this.recentScores = {}
  }

  private completeSource(source: Source): Promise<any> {
    let {engross, firstMatch} = source
    let start = Date.now()
    let s = new Serial()
    let {col} = this.option
    // new option for each source
    let option = Object.assign({}, this.option)
    s.timeout(Math.max(getConfig('timeout'), 300))
    s.add((done, ctx) => {
      source.shouldComplete(option).then(res => {
        ctx.shouldRun = res
        done()
      }, done)
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
        if (engross
          || result.startcol && result.startcol != col) {
          result.engross = true
        }
        result.filter = source.filter
        result.priority = source.priority
        result.source = source.name
        result.firstMatch = firstMatch
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
    let {items, firstMatch, filter, startcol} = result
    if (!items || items.length == 0) return false
    let {line, colnr, col} = opt
    let input = result.input || opt.input
    if (startcol && startcol != col) {
      input = byteSlice(line, startcol, colnr - 1)
    }
    let field = filter || 'word'
    let fuzzy = getConfig('fuzzyMatch')
    let codes = fuzzy ? getCharCodes(input) : []
    return items.some(item => {
      let s = item[field]
      if (firstMatch && s[0] !== input[0]) return false
      if (fuzzy) return fuzzyMatch(codes, s)
      return filterWord(input, s, !/A-Z/.test(input))
    })
  }

  public filterResults(results:CompleteResult[]):VimCompleteItem[] {
    let arr: VimCompleteItem[] = []
    let {input, id} = this.option
    let fuzzy = getConfig('fuzzyMatch')
    let codes = fuzzy ? getCharCodes(input) : []
    let filter = fuzzy ? (_, verb) => {
      return fuzzyMatch(codes, verb)
    } : (input, verb) => {
      return filterWord(input, verb, !/A-Z/.test(input))
    }
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let filterField = res.filter || 'word'
      let {items, source, firstMatch} = res
      if (firstMatch && input.length == 0) break
      for (let item of items) {
        let {word, abbr, user_data} = item
        let verb = filterField == 'abbr' ? abbr: word
        let data = {}
        if (input.length && !filter(input, verb)) continue
        if (user_data) {
          try {
            data = JSON.parse(user_data)
          } catch (e) {} // tslint:disable-line
        }
        data = Object.assign(data, { cid: id, source, filter: filterField })
        item.user_data = JSON.stringify(data)
        if (fuzzy) item.score = score(verb, input) + this.getBonusScore(input, item)
        arr.push(item)
      }
    }
    if (fuzzy) {
      arr.sort((a, b) => b.score - a.score)
    } else {
      arr = wordSortItems(arr, input)
    }
    arr = arr.slice(0, MAX_ITEM_COUNT)
    return uniqueItems(arr)
  }

  public async doComplete(sources: Source[]): Promise<[number, VimCompleteItem[]]> {
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
    let key = `${input.slice(0,3)}|${word}`
    let score = this.recentScores[key] || 0
    score += (input && word[0] == input[0]) ? 0.001 : 0
    score += kind ? 0.001 : 0
    score += abbr ? 0.001 : 0
    score += info ? 0.001 : 0
    return score
  }
}
