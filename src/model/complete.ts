import { score } from 'fuzzaldrin'
import Serial from 'node-serial'
import { CompleteConfig, CompleteOption, CompleteResult, ISource, RecentScore, VimCompleteItem } from '../types'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { byteSlice } from '../util/string'
const logger = require('../util/logger')('model-complete')

export type Callback = () => void

const WORD_SOURCES = new Set(['word', 'around', 'buffer', 'dictionary', 'tag', 'emoji', 'include'])

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public option: CompleteOption
  public readonly recentScores: RecentScore
  constructor(opts: CompleteOption,
    recentScores: RecentScore | null,
    private config: CompleteConfig) {
    this.option = opts
    Object.defineProperty(this, 'recentScores', {
      get: (): RecentScore => {
        return recentScores || {}
      }
    })
  }

  public get startcol(): number {
    return this.option.col || 0
  }

  private get id(): number {
    return this.option.id
  }

  private completeSource(source: ISource): Promise<CompleteResult | null> {
    let start = Date.now()
    let s = new Serial()
    let { col } = this.option
    // new option for each source
    let option = Object.assign({}, this.option)
    let timeout = this.config.timeout
    s.timeout(Math.min(timeout, 3000))
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
      if (!ctx.shouldRun) return done()
      source.doComplete(option).then(result => {
        if (result == null || result.items.length == 0) {
          return done()
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
          logger.error('Complete error:', source.name, err)
          resolve(null)
          return
        }
        logger.debug(`Complete '${source.name}' takes ${Date.now() - start}ms`)
        resolve(ctx.result || null)
      })
    })
  }

  public filterResults(input: string, isIncrement = false): VimCompleteItem[] {
    let { results } = this
    if (results.length == 0) return []
    let arr: VimCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let { items, source, priority } = res
      if (input.length == 0 && WORD_SOURCES.has(source)) {
        continue
      }
      for (let item of items) {
        let { user_data, filterText, word } = item
        if (words.has(word)) continue
        let data = {} as any
        filterText = filterText || item.word
        if (user_data) {
          try {
            data = JSON.parse(user_data)
            filterText = data.filter ? data.filter : filterText
          } catch (e) { } // tslint:disable-line
        }
        if (filterText.length < input.length) continue
        if (isIncrement && item.sortText) delete item.sortText
        if (input.length && !fuzzyMatch(codes, filterText)) continue
        if (!data.cid) {
          data = Object.assign(data, { cid: this.id, source })
          item.user_data = JSON.stringify(data)
        }
        let factor = priority / 10000 + this.getBonusScore(input, item)
        item.score = score(filterText, input) + factor
        words.add(word)
        arr.push(item)
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      if (sa && sb) {
        if (sa === sb) return b.score - a.score
        return sa < sb ? -1 : 1
      } else {
        return b.score - a.score
      }
    })
    return arr.slice(0, this.config.maxItemCount)
  }

  public async doComplete(sources: ISource[]): Promise<VimCompleteItem[]> {
    let opts = this.option
    let { line, colnr } = opts
    sources.sort((a, b) => b.priority - a.priority)
    let results = await Promise.all(sources.map(s => this.completeSource(s)))
    results = results.filter(r => {
      // error/empty result
      return r != null
    })
    if (results.length == 0) return []
    let engrossResult = results.find(r => r.engross === true)
    if (engrossResult) {
      let { startcol } = engrossResult
      if (startcol != null) {
        opts.col = startcol
        opts.input = byteSlice(line, startcol, colnr - 1)
      }
      results = [engrossResult]
    }
    this.results = results
    logger.info(`Results from: ${results.map(s => s.source).join(',')}`)
    return this.filterResults(opts.input)
  }

  private getBonusScore(input: string, item: VimCompleteItem): number {
    let { word, abbr, kind, info } = item
    let score = input.length
      ? this.recentScores[`${input.slice(0, 1)}|${word}`] || 0
      : 0
    score += kind ? 0.001 : 0
    score += abbr ? 0.001 : 0
    score += info ? 0.001 : 0
    return score
  }
}
