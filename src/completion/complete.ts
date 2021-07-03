import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Emitter, Event, Position } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { CompleteOption, VimCompleteItem, CompleteResult, ExtendedCompleteItem, ISource, RecentScore } from '../types'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { byteSlice, characterIndex } from '../util/string'
import { matchScore } from './match'
const logger = require('../util/logger')('completion-complete')

export interface CompleteConfig {
  disableKind: boolean
  disableMenu: boolean
  disableMenuShortcut: boolean
  enablePreview: boolean
  enablePreselect: boolean
  labelMaxLength: number
  floatEnable: boolean
  maxPreviewWidth: number
  autoTrigger: string
  previewIsKeyword: string
  triggerCompletionWait: number
  minTriggerInputLength: number
  triggerAfterInsertEnter: boolean
  acceptSuggestionOnCommitCharacter: boolean
  noselect: boolean
  keepCompleteopt: boolean
  numberSelect: boolean
  maxItemCount: number
  timeout: number
  snippetIndicator: string
  fixInsertedWord: boolean
  localityBonus: boolean
  highPrioritySourceLimit: number
  lowPrioritySourceLimit: number
  removeDuplicateItems: boolean
  defaultSortMethod: string
  asciiCharactersOnly: boolean
}

export interface Documentation {
  filetype: string
  content: string
  active?: [number, number]
}

export type Callback = () => void

// first time completion
const FIRST_TIMEOUT = 500

export default class Complete {
  // identify this complete
  public results: CompleteResult[] = []
  public readonly recentScores: RecentScore
  private completing: Set<string> = new Set()
  private _canceled = false
  private localBonus: Map<string, number>
  private tokenSources: Map<string, CancellationTokenSource> = new Map()
  private readonly _onDidComplete = new Emitter<void>()
  public readonly onDidComplete: Event<void> = this._onDidComplete.event
  constructor(public option: CompleteOption,
    private document: Document,
    recentScores: RecentScore | null,
    private config: CompleteConfig,
    private sources: ISource[],
    private nvim: Neovim) {
    Object.defineProperty(this, 'recentScores', {
      get: (): RecentScore => recentScores || {}
    })
  }

  public get isCompleting(): boolean {
    return this.completing.size > 0
  }

  public get isCanceled(): boolean {
    return this._canceled
  }

  public get isEmpty(): boolean {
    return this.results.length == 0
  }

  public get startcol(): number {
    return this.option.col || 0
  }

  public get input(): string {
    return this.option.input
  }

  public get isIncomplete(): boolean {
    return this.results.findIndex(o => o.isIncomplete) !== -1
  }

  private async completeSource(source: ISource): Promise<void> {
    let { col } = this.option
    // new option for each source
    let opt = Object.assign({}, this.option)
    let timeout = this.config.timeout
    timeout = Math.max(Math.min(timeout, 15000), 500)
    try {
      if (typeof source.shouldComplete === 'function') {
        let shouldRun = await Promise.resolve(source.shouldComplete(opt))
        if (!shouldRun) return null
      }
      let start = Date.now()
      let oldSource = this.tokenSources.get(source.name)
      if (oldSource) oldSource.cancel()
      let tokenSource = new CancellationTokenSource()
      this.tokenSources.set(source.name, tokenSource)
      await new Promise<CompleteResult>((resolve, reject) => {
        let { name } = source
        let timer = setTimeout(() => {
          this.nvim.command(`echohl WarningMsg| echom 'source ${source.name} timeout after ${timeout}ms'|echohl None`, true)
          tokenSource.cancel()
        }, timeout)
        let cancelled = false
        let called = false
        let empty = false
        let ft = setTimeout(() => {
          if (called) return
          empty = true
          resolve(undefined)
        }, FIRST_TIMEOUT)
        let onFinished = () => {
          if (called) return
          called = true
          disposable.dispose()
          clearTimeout(ft)
          clearTimeout(timer)
          this.tokenSources.delete(name)
        }
        let disposable = tokenSource.token.onCancellationRequested(() => {
          disposable.dispose()
          this.completing.delete(name)
          cancelled = true
          onFinished()
          logger.debug(`Source "${name}" cancelled`)
          resolve(undefined)
        })
        this.completing.add(name)
        Promise.resolve(source.doComplete(opt, tokenSource.token)).then(result => {
          this.completing.delete(name)
          if (cancelled) return
          onFinished()
          let dt = Date.now() - start
          logger.debug(`Source "${name}" takes ${dt}ms`)
          if (result && result.items && result.items.length) {
            result.priority = source.priority
            result.source = name
            // lazy completed items
            if (empty && result.startcol && result.startcol != col) {
              this.results = [result]
            } else {
              let { results } = this
              let idx = results.findIndex(o => o.source == name)
              if (idx != -1) {
                results.splice(idx, 1, result)
              } else {
                results.push(result)
              }
            }
            if (empty) this._onDidComplete.fire()
            resolve(undefined)
          } else {
            resolve(undefined)
          }
        }, err => {
          this.completing.delete(name)
          onFinished()
          reject(err)
        })
      })
    } catch (err) {
      this.nvim.command(`echoerr 'Complete ${source.name} error: ${err.message.replace(/'/g, "''")}'`, true)
      logger.error('Complete error:', source.name, err)
    }
  }

  public async completeInComplete(resumeInput: string): Promise<ExtendedCompleteItem[]> {
    let { results, document } = this
    let remains = results.filter(res => !res.isIncomplete)
    remains.forEach(res => {
      res.items.forEach(item => delete item.user_data)
    })
    let arr = results.filter(res => res.isIncomplete)
    let names = arr.map(o => o.source)
    let { input, colnr, linenr } = this.option
    Object.assign(this.option, {
      input: resumeInput,
      line: document.getline(linenr - 1),
      colnr: colnr + (resumeInput.length - input.length),
      triggerCharacter: null,
      triggerForInComplete: true
    })
    let sources = this.sources.filter(s => names.includes(s.name))
    await Promise.all(sources.map(s => this.completeSource(s)))
    return this.filterResults(resumeInput, Math.floor(Date.now() / 1000))
  }

  public filterResults(input: string, cid = 0): ExtendedCompleteItem[] {
    let { results } = this
    results.sort((a, b) => {
      if (a.source == 'tabnine') return 1
      if (b.source == 'tabnine') return -1
      return b.priority - a.priority
    })
    let now = Date.now()
    let { bufnr } = this.option
    let { snippetIndicator, removeDuplicateItems, fixInsertedWord, asciiCharactersOnly } = this.config
    let followPart = (!fixInsertedWord || cid == 0) ? '' : this.getFollowPart()
    if (results.length == 0) return []
    let arr: ExtendedCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let { items, source, priority } = res
      for (let idx = 0; idx < items.length; idx++) {
        let item = items[idx]
        if (!item || typeof item.word !== 'string') {
          continue
        }
        let { word } = item
        // eslint-disable-next-line no-control-regex
        if (asciiCharactersOnly && !/^[\x00-\x7F]*$/.test(word)) {
          continue
        }
        if (!item.dup && words.has(word)) continue
        if (removeDuplicateItems && !item.isSnippet && words.has(word) && item.line == undefined) continue
        let filterText = item.filterText || item.word
        item.filterText = filterText
        if (filterText.length < input.length) continue
        let score = item.kind && filterText == input ? 64 : matchScore(filterText, codes)
        if (input.length && score == 0) continue
        if (followPart.length && !item.isSnippet) {
          if (item.word.endsWith(followPart)) {
            let { word } = item
            item.word = item.word.slice(0, - followPart.length)
            item.abbr = item.abbr || word
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
          let recentScore = this.recentScores[`${bufnr}|${word}`]
          if (recentScore && now - recentScore < 60 * 1000) {
            item.recentScore = recentScore
          } else {
            item.recentScore = 0
          }
        }
        item.priority = priority
        item.abbr = item.abbr || item.word
        item.score = input.length ? score * (item.sourceScore || 1) : 0
        item.localBonus = this.localBonus ? this.localBonus.get(filterText) || 0 : 0
        words.add(word)
        if (item.isSnippet && item.word == input) {
          item.preselect = true
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
      if (sa && sb && sa != sb) return sa < sb ? -1 : 1
      if (a.recentScore != b.recentScore) return b.recentScore - a.recentScore
      if (a.localBonus != b.localBonus) {
        if (a.localBonus && b.localBonus && wa != wb) {
          if (wa.startsWith(wb)) return 1
          if (wb.startsWith(wa)) return -1
        }
        return b.localBonus - a.localBonus
      }
      // Default sort method
      switch (this.config.defaultSortMethod) {
        case 'none':
          return 0
        case 'alphabetical':
          return a.filterText.localeCompare(b.filterText)
        case 'length':
        default: // Fallback on length
          return a.filterText.length - b.filterText.length
      }
    })
    return this.limitCompleteItems(arr.slice(0, this.config.maxItemCount))
  }

  private limitCompleteItems(items: ExtendedCompleteItem[]): ExtendedCompleteItem[] {
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
      let idx = items.findIndex(item => fuzzyMatch(codes, item.filterText || item.word))
      if (idx !== -1) return true
    }
    return false
  }

  public async doComplete(): Promise<ExtendedCompleteItem[]> {
    let opts = this.option
    let { line, colnr, linenr, col } = this.option
    if (this.config.localityBonus) {
      let line = linenr - 1
      this.localBonus = this.document.getLocalifyBonus(Position.create(line, opts.col - 1), Position.create(line, colnr))
    } else {
      this.localBonus = new Map()
    }
    await Promise.all(this.sources.map(s => this.completeSource(s)))
    let { results } = this
    if (results.length == 0) return []
    let engrossResult = results.find(r => r.startcol != null && r.startcol != col)
    if (engrossResult) {
      let { startcol } = engrossResult
      opts.col = startcol
      opts.input = byteSlice(line, startcol, colnr - 1)
      this.results = [engrossResult]
    }
    logger.info(`Results from: ${this.results.map(s => s.source).join(',')}`)
    return this.filterResults(opts.input, Math.floor(Date.now() / 1000))
  }

  public resolveCompletionItem(item: VimCompleteItem): ExtendedCompleteItem | null {
    let { results } = this
    if (!results) return null
    try {
      if (item.user_data) {
        let { source } = JSON.parse(item.user_data)
        let result = results.find(res => res.source == source)
        return result.items.find(o => o.user_data == item.user_data)
      }
      for (let result of results) {
        let res = result.items.find(o => o.abbr == item.abbr && o.info == item.info)
        if (res) return res
      }
      return null
    } catch (e) {
      return null
    }
  }

  private getFollowPart(): string {
    let { colnr, line } = this.option
    let idx = characterIndex(line, colnr - 1)
    if (idx == line.length) return ''
    let part = line.slice(idx - line.length)
    return part.match(/^\S?[\w-]*/)[0]
  }

  public dispose(): void {
    if (this._canceled) return
    this._onDidComplete.dispose()
    this._canceled = true
    for (let tokenSource of this.tokenSources.values()) {
      tokenSource.cancel()
    }
    this.tokenSources.clear()
    this.sources = []
    this.results = []
  }
}
