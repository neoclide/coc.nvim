'use strict'
import { Neovim } from '@chemzqm/neovim'
import unidecode from 'unidecode'
import { CancellationToken, CancellationTokenSource, Emitter, Event, Position } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, FloatConfig, ISource } from '../types'
import { wait } from '../util'
import { getCharCodes } from '../util/fuzzy'
import { byteSlice, isWord } from '../util/string'
import { matchScoreWithPositions } from './match'
import type { Selection } from './mru'
const logger = require('../util/logger')('completion-complete')

export interface CompleteConfig {
  noselect: boolean
  pumwidth: number
  enablePreselect: boolean
  asciiMatch: boolean
  formatItems: ReadonlyArray<string>
  selection: Selection
  virtualText: boolean
  labelMaxLength: number
  autoTrigger: string
  triggerCompletionWait: number
  minTriggerInputLength: number
  triggerAfterInsertEnter: boolean
  acceptSuggestionOnCommitCharacter: boolean
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
  ignoreRegexps: ReadonlyArray<string>
  ambiguousIsNarrow: boolean
  floatConfig: FloatConfig
  pumFloatConfig: FloatConfig
  reversePumAboveCursor: boolean
}

export type Callback = () => void

export default class Complete {
  // identify this complete
  private results: Map<string, CompleteResult> = new Map()
  private _input = ''
  private _completing = false
  private localBonus: Map<string, number> = new Map()
  private tokenSource: CancellationTokenSource
  private timer: NodeJS.Timer
  private names: string[] = []
  private inputOffset = 0
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  constructor(public option: CompleteOption,
    private document: Document,
    private config: CompleteConfig,
    private sources: ISource[],
    private nvim: Neovim) {
    this.tokenSource = new CancellationTokenSource()
    sources.sort((a, b) => b.priority - a.priority)
    this.names = sources.map(o => o.name)
  }

  private fireRefresh(waitTime: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this._onDidRefresh.fire()
    }, waitTime)
  }

  public get isCompleting(): boolean {
    return this._completing
  }

  public get input(): string {
    return this._input
  }

  public get isEmpty(): boolean {
    let empty = true
    for (let res of this.results.values()) {
      if (res.items.length > 0) {
        empty = false
        break
      }
    }
    return empty
  }

  public getIncompleteSources(): string[] {
    let names: string[] = []
    for (let [name, result] of this.results.entries()) {
      if (result.isIncomplete) {
        names.push(name)
      }
    }
    return names
  }

  public async doComplete(): Promise<boolean> {
    let token = this.tokenSource.token
    let res = await Promise.all([
      this.nvim.call('coc#util#synname', []),
      this.nvim.call('coc#util#suggest_variables', [this.option.bufnr]),
      this.document.patchChange()
    ])
    if (token.isCancellationRequested) return
    this.option.synname = res[0]
    let variables = res[1]
    if (variables.disable) {
      logger.warn('suggest cancelled by b:coc_suggest_disable')
      return true
    }
    if (variables.disabled_sources?.length) {
      this.sources = this.sources.filter(s => !variables.disabled_sources.includes(s.name))
      if (this.sources.length === 0) {
        logger.warn('suggest cancelled by b:coc_disabled_sources')
        return true
      }
    }
    if (variables.blacklist?.length) {
      if (variables.blacklist.includes(this.option.input)) {
        logger.warn('suggest cancelled by b:coc_suggest_blacklist')
        return true
      }
    }
    let { triggerCompletionWait, localityBonus } = this.config
    await wait(Math.min(triggerCompletionWait ?? 0, 50))
    if (token.isCancellationRequested) return
    let { colnr, linenr, col } = this.option
    if (localityBonus) {
      let line = linenr - 1
      this.localBonus = this.document.getLocalifyBonus(Position.create(line, col - 1), Position.create(line, colnr))
    }
    await this.completeSources(this.sources, false)
  }

  private async completeSources(sources: ReadonlyArray<ISource>, isFilter: boolean): Promise<void> {
    let { timeout } = this.config
    let { results, tokenSource, } = this
    let col = this.option.col
    let names = sources.map(s => s.name)
    let total = names.length
    this._completing = true
    let token = tokenSource.token
    let timer: NodeJS.Timer
    let tp = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        if (!tokenSource.token.isCancellationRequested) {
          names = names.filter(n => !finished.includes(n))
          tokenSource.cancel()
          logger.warn(`Complete timeout after ${timeout}ms`, names)
          this.nvim.setVar(`coc_timeout_sources`, names, true)
        }
        resolve()
      }, typeof timeout === 'number' ? timeout : 500)
    })
    const finished: string[] = []
    await Promise.race([
      tp,
      Promise.all(sources.map(s => this.completeSource(s, token).then(() => {
        finished.push(s.name)
        if (token.isCancellationRequested || isFilter) return
        let colChanged = this.option.col !== col
        if (colChanged) this.cancel()
        if (colChanged || finished.length === total) {
          this.fireRefresh(0)
        } else if (results.has(s.name)) {
          this.fireRefresh(16)
        }
      })))])
    clearTimeout(timer)
    this._completing = false
  }

  private async completeSource(source: ISource, token: CancellationToken): Promise<void> {
    // new option for each source
    let opt = Object.assign({}, this.option)
    let { asciiMatch } = this.config
    let { name } = source
    try {
      if (typeof source.shouldComplete === 'function') {
        let shouldRun = await Promise.resolve(source.shouldComplete(opt))
        if (!shouldRun || token.isCancellationRequested) return
      }
      const priority = source.priority ?? 0
      const start = Date.now()
      await new Promise<void>((resolve, reject) => {
        Promise.resolve(source.doComplete(opt, token)).then(result => {
          if (token.isCancellationRequested) {
            resolve(undefined)
            return
          }
          let len = result ? result.items.length : 0
          logger.debug(`Source "${name}" finished with ${len} items ${Date.now() - start}ms`)
          if (len > 0) {
            result.items.forEach(item => {
              item.word = item.word ?? ''
              item.abbr = item.abbr ?? item.word
              item.source = name
              item.priority = priority
              item.filterText = asciiMatch ? unidecode(item.filterText ?? item.word) : item.filterText ?? item.word
              if (name !== 'snippets') item.localBonus = this.localBonus.get(item.filterText) ?? 0
            })
            this.setResult(name, result)
          } else {
            this.results.delete(name)
          }
          resolve()
        }, err => {
          reject(err)
        })
      })
    } catch (err) {
      // this.nvim.echoError(err)
      logger.error('Complete error:', source.name, err)
    }
  }

  public async completeInComplete(resumeInput: string, names: string[]): Promise<ExtendedCompleteItem[] | undefined> {
    let { document } = this
    this.cancel()
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    await document.patchChange(true)
    if (token.isCancellationRequested) return undefined
    let { input, colnr, linenr } = this.option
    let character = resumeInput[resumeInput.length - 1]
    Object.assign(this.option, {
      input: resumeInput,
      line: document.getline(linenr - 1),
      colnr: colnr + (resumeInput.length - input.length),
      triggerCharacter: !character || isWord(character) ? undefined : character,
      triggerForInComplete: true
    })
    let sources = this.sources.filter(s => names.includes(s.name))
    await this.completeSources(sources, true)
    if (token.isCancellationRequested) return undefined
    return this.filterItems(resumeInput)
  }

  public filterItems(input: string): ExtendedCompleteItem[] | undefined {
    let { results, names, inputOffset } = this
    if (inputOffset > 0) input = byteSlice(input, inputOffset)
    this._input = input
    if (results.size == 0) return []
    let len = input.length
    let emptyInput = len == 0
    let { maxItemCount, asciiMatch, defaultSortMethod, removeDuplicateItems } = this.config
    let arr: ExtendedCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    for (let name of names) {
      let result = results.get(name)
      if (!result) continue
      let snippetSource = name === 'snippets'
      let items = result.items
      for (let idx = 0; idx < items.length; idx++) {
        let item = items[idx]
        let { word, filterText, abbr, dup } = item
        if (dup !== 1 && words.has(word)) continue
        if (filterText.length < len) continue
        if (removeDuplicateItems && item.isSnippet !== true && words.has(word)) continue
        if (!emptyInput) {
          let positions: ReadonlyArray<number> | undefined
          let score: number
          if (item.kind && filterText === input) {
            score = 64
            positions = Array.from({ length: filterText.length }, (x, i) => i)
          } else {
            let res = matchScoreWithPositions(filterText, codes)
            score = res == null ? 0 : res[0]
            if (res != null) positions = res[1]
          }
          // let score = item.kind && filterText == input ? 64 : matchScore(filterText, codes)
          if (score === 0) continue
          if (filterText == (asciiMatch ? unidecode(abbr) : abbr)) {
            item.positions = positions
          } else if (positions && positions.length > 0) {
            let idx = abbr.indexOf(filterText.slice(0, positions[positions.length - 1] + 1))
            if (idx !== -1) item.positions = positions.map(i => i + idx)
          }
          if (snippetSource && word === input) {
            item.score = 99
          } else {
            item.score = score * (item.sourceScore || 1)
          }
        }
        words.add(word)
        arr.push(item)
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      if (a.score !== b.score) return b.score - a.score
      if (a.priority !== b.priority) return b.priority - a.priority
      if (a.localBonus !== b.localBonus) return b.localBonus - a.localBonus
      if (a.source === b.source && sa !== sb) return sa < sb ? -1 : 1
      // not sort with empty input
      if (input.length === 0) return 0
      switch (defaultSortMethod) {
        case 'none':
          return 0
        case 'alphabetical':
          return a.filterText.localeCompare(b.filterText)
        case 'length':
        default: // Fallback on length
          return a.filterText.length - b.filterText.length
      }
    })
    return this.limitCompleteItems(arr.slice(0, maxItemCount))
  }

  public async filterResults(input: string): Promise<ExtendedCompleteItem[] | undefined> {
    if (this.timer) clearTimeout(this.timer)
    if (input !== this.option.input) {
      let names = this.getIncompleteSources()
      if (names.length) {
        return await this.completeInComplete(input, names)
      }
    }
    return this.filterItems(input)
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

  // handle startcol change
  private setResult(name: string, result: CompleteResult): void {
    let { results } = this
    let { line, colnr, col } = this.option
    if (typeof result.startcol === 'number' && result.startcol != col) {
      let { startcol } = result
      if (startcol < col) this.inputOffset = col - startcol
      this.option.col = startcol
      this.option.input = byteSlice(line, startcol, colnr - 1)
      results.clear()
      results.set(name, result)
    } else {
      results.set(name, result)
    }
  }

  private cancel(): void {
    let { tokenSource, timer } = this
    if (timer) clearTimeout(timer)
    tokenSource.cancel()
    this._completing = false
  }

  public dispose(): void {
    this.cancel()
    this._onDidRefresh.dispose()
    this.sources = []
    this.results.clear()
  }
}
