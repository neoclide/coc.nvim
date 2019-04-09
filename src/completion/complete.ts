import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Position } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { CompleteConfig, CompleteOption, CompleteResult, ISource, RecentScore, VimCompleteItem } from '../types'
import { echoErr, echoWarning } from '../util'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { byteSlice, characterIndex } from '../util/string'
import { matchScore } from './match'
const logger = require('../util/logger')('completion-complete')

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public readonly recentScores: RecentScore
  private _canceled = false
  private sources: ISource[]
  private localBonus: Map<string, number>
  private tokenSources: Set<CancellationTokenSource> = new Set()
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

  public get isCanceled(): boolean {
    return this._canceled
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
      let tokenSource = new CancellationTokenSource()
      this.tokenSources.add(tokenSource)
      let result = await new Promise<CompleteResult>((resolve, reject) => {
        let timer = setTimeout(() => {
          disposable.dispose()
          tokenSource.cancel()
          echoWarning(this.nvim, `source ${source.name} timeout after ${timeout}ms`)
          resolve(null)
        }, timeout)
        let called = false
        let onFinished = () => {
          if (called) return
          called = true
          disposable.dispose()
          clearTimeout(timer)
          this.tokenSources.delete(tokenSource)
        }
        let disposable = tokenSource.token.onCancellationRequested(() => {
          onFinished()
          reject(new Error('Cancelled request'))
        })
        Promise.resolve(source.doComplete(opt, tokenSource.token)).then(result => {
          onFinished()
          resolve(result)
        }, err => {
          onFinished()
          reject(err)
        })
      })
      let dt = Date.now() - start
      logger[dt > 1000 ? 'warn' : 'debug'](`Complete source "${source.name}" takes ${dt}ms`)
      if (result == null || result.items.length == 0) {
        return null
      }
      if (result.startcol != null && result.startcol != col) {
        result.engross = true
      }
      result.priority = source.priority
      result.source = source.name
      result.completeInComplete = completeInComplete
      return result
    } catch (err) {
      if (err.message && err.message.indexOf('Cancelled') != -1) return null
      echoErr(this.nvim, `${source.name} complete error: ${err}`)
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
    let followPart = (!fixInsertedWord || cid == 0) ? '' : this.getFollowPart()
    if (results.length == 0) return []
    // max score of high priority source
    let maxScore = 0
    let arr: VimCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    let filtering = input.length > this.input.length
    let preselect: VimCompleteItem = null
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let { items, source, priority } = res
      // tslint:disable-next-line: prefer-for-of
      for (let idx = 0; idx < items.length; idx++) {
        let item = items[idx]
        let { word } = item
        if (!item.dup && words.has(word)) continue
        let filterText = item.filterText || item.word
        item.filterText = filterText
        if (filterText.length < input.length) continue
        let score = matchScore(filterText, codes)
        if (input.length && score == 0) continue
        if (priority > 90) maxScore = Math.max(maxScore, score)
        if (maxScore > 5 && priority <= 10 && score < maxScore) continue
        if (followPart.length && !item.isSnippet) {
          if (item.word.endsWith(followPart)) {
            item.word = item.word.slice(0, - followPart.length)
          }
        }
        if (!item.user_data) {
          let user_data: any = { cid, source }
          user_data.index = item.index || idx
          if (item.isSnippet) {
            let abbr = item.abbr || item.word
            if (!abbr.endsWith(snippetIndicator)) {
              item.abbr = `${item.abbr || item.word}${snippetIndicator}`
            }
          }
          if (item.signature) user_data.signature = item.signature
          item.user_data = JSON.stringify(user_data)
          item.source = source
        }
        item.priority = priority
        item.score = input.length ? score : 0
        item.localBonus = this.localBonus ? this.localBonus.get(filterText) || 0 : 0
        item.recentScore = item.recentScore || 0
        if (!item.recentScore) {
          let recentScore = this.recentScores[`${bufnr}|${word}`]
          if (recentScore && now - recentScore < 60 * 1000) {
            item.recentScore = recentScore
          }
        }
        words.add(word)
        if (!preselect) {
          if (item.isSnippet && item.word == input) {
            preselect = item
            continue
          } else if (!filtering && item.preselect) {
            preselect = item
            continue
          }
        }
        arr.push(item)
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      let wa = a.filterText
      let wb = b.filterText
      if (a.score != b.score) return b.score - a.score
      if (a.priority != b.priority) return b.priority - a.priority
      if (wa.startsWith(wb)) return 1
      if (wb.startsWith(wa)) return -1
      if (sa && sb && sa != sb) return sa < sb ? -1 : 1
      if (a.recentScore != b.recentScore) return b.recentScore - a.recentScore
      if (a.localBonus != b.localBonus) return b.localBonus - a.localBonus
      return a.filterText.length - b.filterText.length
    })
    let items = arr.slice(0, this.config.maxItemCount)
    if (preselect) items.unshift(preselect)
    return this.limitCompleteItems(items)
  }

  private limitCompleteItems(items: VimCompleteItem[]): VimCompleteItem[] {
    let { highPrioritySourceLimit, lowPrioritySourceLimit } = this.config
    if (!highPrioritySourceLimit && !lowPrioritySourceLimit) return items
    let counts: Map<string, number> = new Map()
    return items.filter(item => {
      let { priority, source } = item
      let isLow = priority < 90
      let curr = counts.get(source) || 0
      if ((lowPrioritySourceLimit && isLow && curr == lowPrioritySourceLimit)
        || (highPrioritySourceLimit && !isLow && curr == highPrioritySourceLimit)) {
        return false
      }
      counts.set(source, curr + 1)
      return true
    })
  }

  public hasMatch(input: string): boolean {
    let { results } = this
    if (!results) return false
    let codes = getCharCodes(input)
    for (let i = 0, l = results.length; i < l; i++) {
      let items = results[i].items
      let idx = items.findIndex(item => {
        return fuzzyMatch(codes, item.filterText || item.word)
      })
      if (idx !== -1) return true
    }
    return false
  }

  public async doComplete(sources: ISource[]): Promise<VimCompleteItem[]> {
    let opts = this.option
    let { line, colnr, linenr } = opts
    sources.sort((a, b) => b.priority - a.priority)
    this.sources = sources
    if (this.config.localityBonus) {
      let line = linenr - 1
      this.localBonus = this.document.getLocalifyBonus(Position.create(line, opts.col - 1), Position.create(line, colnr))
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

  public resolveCompletionItem(item: VimCompleteItem): VimCompleteItem | null {
    let { results } = this
    if (!results || !item.user_data) return null
    try {
      let { source } = JSON.parse(item.user_data)
      let result = results.find(res => res.source == source)
      return result.items.find(o => o.user_data == item.user_data)
    } catch (e) {
      return null
    }
  }

  private getFollowPart(): string {
    let { colnr, line } = this.option
    let idx = characterIndex(line, colnr - 1)
    if (idx == line.length) return ''
    let part = line.slice(idx - line.length)
    return part.match(/^\S?[\w\-]*/)[0]
  }

  public cancel(): void {
    this._canceled = true
    for (let tokenSource of this.tokenSources) {
      tokenSource.cancel()
    }
    this.tokenSources.clear()
  }
}
