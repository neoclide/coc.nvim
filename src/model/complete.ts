import { score } from 'fuzzaldrin-plus'
import { CompleteConfig, CompleteOption, CompleteResult, ISource, RecentScore, VimCompleteItem } from '../types'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { byteSlice } from '../util/string'
import { echoWarning, echoErr } from '../util'
import { Neovim } from '@chemzqm/neovim'
import { omit } from '../util/lodash'
const logger = require('../util/logger')('model-complete')

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public readonly recentScores: RecentScore
  constructor(private option: CompleteOption,
    recentScores: RecentScore | null,
    private config: CompleteConfig,
    private nvim: Neovim) {
    Object.defineProperty(this, 'recentScores', {
      get: (): RecentScore => {
        return recentScores || {}
      }
    })
  }

  public get startcol(): number {
    return this.option.col || 0
  }

  private async completeSource(source: ISource): Promise<CompleteResult | null> {
    let { col } = this.option
    // new option for each source
    let option = Object.assign({}, this.option)
    let timeout = this.config.timeout
    timeout = Math.min(timeout, 5000)
    if (typeof source.shouldComplete === 'function') {
      let shouldRun = await Promise.resolve(source.shouldComplete(option))
      if (!shouldRun) return null
    }
    try {
      let start = Date.now()
      let result = await new Promise<CompleteResult>((resolve, reject) => {
        let timer = setTimeout(() => {
          echoWarning(this.nvim, `source ${source.name} timeout after ${timeout}ms`)
          resolve(null)
        }, timeout)
        source.doComplete(option).then(result => {
          clearTimeout(timer)
          resolve(result)
        }, err => {
          clearTimeout(timer)
          reject(err)
        })
      })
      if (result == null || result.items.length == 0) {
        return null
      }
      if (result.startcol != null && result.startcol != col) {
        result.engross = true
      }
      result.isFallback = source.isFallback
      result.priority = source.priority
      result.source = source.name
      result.duplicate = !!source.duplicate
      logger.debug(`Complete '${source.name}' takes ${Date.now() - start}ms`)
      return result
    } catch (err) {
      echoErr(this.nvim, `${source.name} complete error: ${err.message}`)
      logger.error('Complete error:', source.name, err)
      return null
    }
  }

  public filterResults(input: string, cid?: number): VimCompleteItem[] {
    let { results } = this
    if (results.length == 0) return []
    let arr: VimCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    let filtering = input.length > 2
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let { items, source, priority, duplicate } = res
      if (res.isFallback && input.length < 3) continue
      for (let item of items) {
        let { word } = item
        if (words.has(word) && !duplicate) continue
        let filterText = item.filterText || item.word
        if (filterText.length < input.length) continue
        if (input.length && !fuzzyMatch(codes, filterText)) continue
        if (cid) {
          let data = {} as any
          if (item.user_data) {
            try {
              data = JSON.parse(item.user_data)
            } catch (e) { } // tslint:disable-line
          }
          Object.assign(data, { cid, source })
          item.user_data = JSON.stringify(data)
          item.source = source
        }
        let factor = priority * 100 + this.getBonusScore(input, item)
        item.score = score(filterText, input) + factor
        words.add(word)
        if (filtering && item.word.startsWith(input)) {
          arr.push(omit(item, ['sortText']))
        } else {
          arr.push(item)
        }
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      if (a.source == b.source && sa && sb) {
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
    results = results.filter(r => r != null && r.items && r.items.length > 0)
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
    return this.filterResults(opts.input, Math.floor(Date.now() / 1000))
  }

  private getBonusScore(input: string, item: VimCompleteItem): number {
    let { word, abbr, kind, info } = item
    let score = input.length
      ? this.recentScores[`${input.slice(0, 1)}|${word}`] || 0
      : 0
    score += kind ? 1 : 0
    score += abbr ? 1 : 0
    score += info ? 1 : 0
    return score
  }
}
