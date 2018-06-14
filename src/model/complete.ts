import {score} from 'fuzzaldrin'
import {Neovim} from 'neovim'
import {
  CompleteOption,
  VimCompleteItem,
  RecentScore,
  ISource,
  CompleteResult} from '../types'
import workspace from '../workspace'
import {byteSlice} from '../util/string'
import {
  getCharCodes,
  fuzzyMatch
} from '../util/fuzzy'
import Serial = require('node-serial')
const logger = require('../util/logger')('model-complete')

const MAX_ITEM_COUNT = 100

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public option: CompleteOption
  public readonly recentScores: RecentScore
  constructor(opts: CompleteOption, recentScores: RecentScore |null) {
    this.option = opts
    Object.defineProperty(this, 'recentScores', {
      get: (): RecentScore => {
        return recentScores || {}
      }
    })
  }

  public get startcol():number {
    return this.option.col || 0
  }

  private completeSource(source: ISource): Promise<any> {
    let start = Date.now()
    let s = new Serial()
    let {col} = this.option
    // new option for each source
    let option = Object.assign({}, this.option)
    let timeout = workspace.getConfiguration('coc.preferences').get('timeout', 300)
    s.timeout(Math.max(timeout, 300))
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
    if (results.length == 0) return []
    let arr: VimCompleteItem[] = []
    let {input, id} = this.option
    let codes = getCharCodes(input)
    let words:Set<string> = new Set()
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let {items, source, priority} = res
      for (let item of items) {
        let {user_data, filterText, word} = item
        if (words.has(word)) continue
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
        item.score = score(filterText, input) + this.getBonusScore(input, item, priority)
        words.add(word)
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
    return arr.slice(0, MAX_ITEM_COUNT)
  }

  public async doComplete(nvim:Neovim, sources:ISource[]): Promise<VimCompleteItem[]> {
    let opts = this.option
    let {line, colnr, reload} = opts
    sources.sort((a, b) => b.priority - a.priority)
    let results = await Promise.all(sources.map(s => this.completeSource(s)))
    results = results.filter(r => {
      // error source
      if (r ===false) return false
      if (r == null) return false
      return this.checkResult(r, opts)
    })
    logger.debug(`Results from sources: ${results.map(s => s.source).join(',')}`)
    if (results.length == 0) return []
    // fix input, user could type fast
    let input = await nvim.call('coc#util#get_input') as string
    let dl = input.length - opts.input.length
    if (dl < 0) return []
    if (dl > 0) {
      line = await nvim.call('getline', ['.'])
      colnr = opts.colnr + dl
      opts.input = input
      opts.line = line
    }

    let engrossResult = results.find(r => r.engross === true)
    if (engrossResult) {
      let {startcol} = engrossResult
      if (startcol != null) {
        opts.col = startcol
        opts.input = byteSlice(line, startcol, colnr - 1)
      }
      results = [engrossResult]
      logger.debug(`Engross source ${engrossResult.source} activted`)
    }
    if (!reload) {
      results = results.filter(r => r.priority != 0)
    }
    this.results = results
    let filteredResults = this.filterResults(results)
    logger.debug('Filtered items: ', filteredResults.length, filteredResults[0])
    return filteredResults
  }

  private getBonusScore(input:string, item: VimCompleteItem, priority:number):number {
    let {word, abbr, kind, info} = item
    let score = input.length
      ? this.recentScores[`${input.slice(0,1)}|${word}`] || 0
      : 0
    if (priority) score += priority/10
    score += (input && word[0] == input[0]) ? 0.001 : 0
    score += kind ? 0.001 : 0
    score += abbr ? 0.001 : 0
    score += info ? 0.001 : 0
    return score
  }
}
