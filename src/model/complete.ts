import { score } from 'fuzzaldrin-plus'
import { CompleteConfig, CompleteOption, CompleteResult, ISource, RecentScore, VimCompleteItem } from '../types'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { byteSlice } from '../util/string'
import { echoWarning, echoErr } from '../util'
import { Neovim } from '@chemzqm/neovim'
import { omit } from '../util/lodash'
import Document from './document'
const logger = require('../util/logger')('model-complete')

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public readonly recentScores: RecentScore
  private sources: ISource[]
  constructor(public option: CompleteOption,
    private document: Document,
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

  public get input(): string {
    return this.option.input
  }

  public get isIncomplete(): boolean {
    return this.results && this.results.findIndex(o => o.isIncomplete == true) !== -1
  }

  private async completeSource(source: ISource): Promise<CompleteResult | null> {
    let { col } = this.option
    // new option for each source
    let opt = Object.assign({}, this.option)
    let timeout = this.config.timeout
    timeout = Math.min(timeout, 5000)
    if (typeof source.shouldComplete === 'function') {
      let shouldRun = await Promise.resolve(source.shouldComplete(opt))
      if (!shouldRun) return null
    }
    try {
      let start = Date.now()
      let result = await new Promise<CompleteResult>((resolve, reject) => {
        let timer = setTimeout(() => {
          echoWarning(this.nvim, `source ${source.name} timeout after ${timeout}ms`)
          resolve(null)
        }, timeout)
        source.doComplete(opt).then(result => {
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
      result.duplicate = source.duplicate
      logger.debug(`Complete '${source.name}' takes ${Date.now() - start}ms`)
      return result
    } catch (err) {
      echoErr(this.nvim, `${source.name} complete error: ${err.message}`)
      logger.error('Complete error:', source.name, err)
      return null
    }
  }

  public async completeInComplete(resumeInput: string): Promise<VimCompleteItem[]> {
    let { results, document } = this
    await document.patchChange()
    document.forceSync()
    let remains = results.filter(res => !res.isIncomplete)
    let arr = results.filter(res => res.isIncomplete == true)
    let names = arr.map(o => o.source)
    let { input, colnr, linenr } = this.option
    Object.assign(this.option, {
      input: resumeInput,
      line: document.getline(linenr - 1),
      colnr: colnr + (resumeInput.length - input.length),
      triggerCharacter: null,
      triggerForInComplete: true
    })
    let sources = this.sources.filter(s => names.indexOf(s.name) !== -1)
    results = await Promise.all(sources.map(s => this.completeSource(s)))
    results = results.concat(remains)
    results = results.filter(r => r != null && r.items && r.items.length > 0)
    let cid = Math.floor(Date.now() / 1000)
    this.results = results
    return this.filterResults(resumeInput, cid)
  }

  public filterResults(input: string, cid?: number): VimCompleteItem[] {
    let { results } = this
    let { bufnr } = this.option
    if (results.length == 0) return []
    let arr: VimCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    let filtering = input.length > this.input.length
    let preselect: VimCompleteItem = null
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
        item.score = score(filterText, input) + this.getBonusScore(item)
        item.recentScore = this.recentScores[`${bufnr}|${word}`] || 0
        item.priority = priority
        item.icase = 1
        item.strictMatch = item.word.startsWith(input)
        words.add(word)
        if (!filtering && item.preselect) {
          preselect = item
          continue
        }
        if (filtering && item.sortText && item.score > 50000) {
          arr.push(omit(item, ['sortText']))
        } else {
          arr.push(item)
        }
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      if (input.length) {
        if (a.strictMatch && !b.strictMatch) return -1
        if (b.strictMatch && !a.strictMatch) return 1
        if (a.strictMatch && b.strictMatch) {
          if (a.priority != b.priority) return b.priority - a.priority
          if (a.recentScore != b.recentScore) return b.recentScore - a.recentScore
        }
      } else if (a.recentScore != b.recentScore) {
        return b.recentScore - a.recentScore
      }
      if (a.source == b.source && sa && sb) {
        if (sa === sb) return b.score - a.score
        return sa < sb ? -1 : 1
      } else {
        return b.score - a.score
      }
    })
    let items = arr.slice(0, this.config.maxItemCount)
    if (preselect) items.unshift(preselect)
    return items.map(o => omit(o, ['sortText', 'priority', 'recentScore', 'filterText', 'source', 'strictMatch', 'score']))
  }

  public async doComplete(sources: ISource[]): Promise<VimCompleteItem[]> {
    let opts = this.option
    let { line, colnr } = opts
    sources.sort((a, b) => b.priority - a.priority)
    this.sources = sources
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

  private getBonusScore(item: VimCompleteItem): number {
    let { abbr, kind, info } = item
    let score = 0
    score += kind ? 1 : 0
    score += abbr ? 1 : 0
    score += info ? 1 : 0
    return score
  }
}
