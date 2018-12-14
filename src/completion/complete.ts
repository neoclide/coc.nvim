import { score } from 'fuzzaldrin-plus'
import { CompleteConfig, CompleteOption, CompleteResult, ISource, RecentScore, VimCompleteItem } from '../types'
import { fuzzyMatch, matchScore, getCharCodes } from '../util/fuzzy'
import { byteSlice } from '../util/string'
import { echoWarning, echoErr } from '../util'
import { Neovim } from '@chemzqm/neovim'
import { omit } from '../util/lodash'
import Document from '../model/document'
import { Chars } from '../model/chars'
const logger = require('../util/logger')('model-complete')

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public readonly recentScores: RecentScore
  private sources: ISource[]
  private localBonus: Map<string, number>
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

  private async completeSource(source: ISource, completeInComplete = false): Promise<CompleteResult | null> {
    let { col } = this.option
    // new option for each source
    let opt = Object.assign({}, this.option)
    let timeout = this.config.timeout
    timeout = Math.min(timeout, 5000)
    try {
      if (typeof source.shouldComplete === 'function') {
        let shouldRun = await Promise.resolve(source.shouldComplete(opt))
        if (!shouldRun) return null
      }
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
      result.completeInComplete = completeInComplete
      result.duplicate = source.duplicate
      let dt = Date.now() - start
      logger[dt > 1000 ? 'warn' : 'debug'](`Complete source "${source.name}" takes ${dt}ms`)
      return result
    } catch (err) {
      echoErr(this.nvim, `${source.name} complete error: ${err.message}`)
      logger.error('Complete error:', source.name, err)
      return null
    }
  }

  public async completeInComplete(resumeInput: string): Promise<VimCompleteItem[]> {
    let { results, document } = this
    let remains = results.filter(res => !res.isIncomplete)
    remains.forEach(res => {
      res.items.forEach(item => delete item.user_data)
    })
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
    results = await Promise.all(sources.map(s => this.completeSource(s, true)))
    results = results.concat(remains)
    results = results.filter(r => r != null && r.items && r.items.length > 0)
    this.results = results
    return this.filterResults(resumeInput, Math.floor(Date.now() / 1000))
  }

  public filterResults(input: string, cid = 0): VimCompleteItem[] {
    let { results } = this
    let now = Date.now()
    let { bufnr } = this.option
    let { snippetIndicator, fixInsertedWord } = this.config
    let followPart = cid == 0 ? '' : this.getFollowPart()
    // let endColnr = this.getEndColnr()
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
        if (fixInsertedWord && followPart.length && !item.isSnippet) {
          if (item.word.endsWith(followPart)) {
            item.word = item.word.slice(0, - followPart.length)
          }
        }
        if (!item.user_data) {
          let user_data: any = { cid, source }
          if (item.isSnippet && cid != 0) {
            let abbr = item.abbr || item.word
            if (!abbr.endsWith(snippetIndicator)) {
              item.abbr = `${item.abbr || item.word}${snippetIndicator}`
            }
          }
          if (item.signature) user_data.signature = item.signature
          item.user_data = JSON.stringify(user_data)
          item.source = source
        }
        item.score = input.length ? score(filterText, input) + (priority * 100) : 0
        item.recentScore = item.recentScore || 0
        if (!item.recentScore) {
          let recentScore = this.recentScores[`${bufnr}|${word}`]
          if (recentScore && now - recentScore < 60 * 1000) {
            item.recentScore = recentScore
          }
        }
        item.localBonus = this.localBonus ? this.localBonus.get(filterText) || 0 : 0
        item.priority = priority
        item.matchScore = matchScore(input, filterText)
        item.strictMatch = input.length && filterText.startsWith(input) ? 1 : 0
        words.add(word)
        if (!filtering && item.preselect) {
          preselect = item
          continue
        }
        if (filtering && item.sortText && input.length > 1) {
          arr.push(omit(item, ['sortText']))
        } else {
          arr.push(item)
        }
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      let strictMatch = a.strictMatch && b.strictMatch
      if (a.matchScore != b.matchScore) return b.matchScore - a.matchScore
      if (strictMatch && a.priority != b.priority) return b.priority - a.priority
      if (strictMatch && a.recentScore != b.recentScore) return b.recentScore - a.recentScore
      if (strictMatch && a.localBonus != b.localBonus) return b.localBonus - a.localBonus
      if (sa && sb) return sa < sb ? -1 : 1
      return b.score - a.score
    })
    let items = arr.slice(0, this.config.maxItemCount)
    if (preselect) items.unshift(preselect)
    return items.map(o => omit(o, ['sortText', 'score', 'priority', 'recentScore', 'filterText', 'strictMatch', 'signature', 'localBonus']))
  }

  public async doComplete(sources: ISource[]): Promise<VimCompleteItem[]> {
    let opts = this.option
    let { line, colnr, linenr } = opts
    sources.sort((a, b) => b.priority - a.priority)
    this.sources = sources
    if (this.config.localityBonus) {
      this.localBonus = this.document.getLocalifyBonus({ line: linenr - 1, character: colnr - 1 })
    } else {
      this.localBonus = new Map()
    }
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

  private getFollowPart(): string {
    let { fixInsertedWord } = this.config
    let { colnr, line } = this.option
    if (!fixInsertedWord) return ''
    return Chars.getContentAfterCharacter(line, colnr - 1)
  }
}
