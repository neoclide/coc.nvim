'use strict'
import type { Neovim } from '@chemzqm/neovim'
import { Position, Range } from 'vscode-languageserver-types'
import { createLogger } from '../logger'
import type Document from '../model/document'
import { waitWithToken } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { anyScore, FuzzyScore, fuzzyScore, fuzzyScoreGracefulAggressive, FuzzyScorer } from '../util/filter'
import * as Is from '../util/is'
import { clamp } from '../util/numbers'
import { CancellationToken, CancellationTokenSource, Disposable, Emitter, Event } from '../util/protocol'
import { characterIndex } from '../util/string'
import workspace from '../workspace'
import { CompleteConfig, CompleteItem, CompleteOption, DurationCompleteItem, InsertMode, ISource, SortMethod } from './types'
import { Converter, ConvertOption, getPriority, useAscii } from './util'
import { WordDistance } from './wordDistance'
const logger = createLogger('completion-complete')
const MAX_DISTANCE = 2 << 20
const MIN_TIMEOUT = 50
const MAX_TIMEOUT = 5000
const MAX_TRIGGER_WAIT = 200

export interface CompleteResultToFilter {
  items: DurationCompleteItem[]
  isIncomplete?: boolean
}

export default class Complete {
  // identify this complete
  private results: Map<string, CompleteResultToFilter> = new Map()
  private _input = ''
  private _completing = false
  private timer: NodeJS.Timer
  private names: string[] = []
  private asciiMatch: boolean
  private timeout: number
  private cid = 0
  private minCharacter = Number.MAX_SAFE_INTEGER
  private inputStart: number
  private readonly _onDidRefresh = new Emitter<void>()
  private wordDistance: WordDistance | undefined
  private tokenSources: Set<CancellationTokenSource> = new Set()
  private tokensInfo: WeakMap<CancellationTokenSource, boolean> = new WeakMap()
  private itemsMap: WeakMap<DurationCompleteItem, CompleteItem> = new WeakMap()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  constructor(public option: CompleteOption,
    private document: Document,
    private config: CompleteConfig,
    private sources: ISource<CompleteItem>[]) {
    this.inputStart = characterIndex(option.line, option.col)
    this.timeout = clamp(this.config.timeout, MIN_TIMEOUT, MAX_TIMEOUT)
    sources.sort((a, b) => (b.priority ?? 99) - (a.priority ?? 99))
    this.names = sources.map(o => o.name)
    this.asciiMatch = config.asciiMatch && useAscii(option.input)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private fireRefresh(waitTime: number): void {
    clearTimeout(this.timer)
    if (!waitTime) {
      this._onDidRefresh.fire()
    } else {
      this.timer = setTimeout(() => {
        this._onDidRefresh.fire()
      }, waitTime)
    }
  }

  private get totalLength(): number {
    let len = 0
    for (let result of this.results.values()) {
      len += result.items.length
    }
    return len
  }

  public resolveItem(item: DurationCompleteItem | undefined): { source: ISource, item: CompleteItem } | undefined {
    if (!item) return undefined
    return { source: item.source, item: this.itemsMap.get(item) }
  }

  public get isCompleting(): boolean {
    return this._completing
  }

  public get input(): string {
    return this._input
  }

  public get isEmpty(): boolean {
    return this.results.size === 0
  }

  private get hasInComplete(): boolean {
    for (let result of this.results.values()) {
      if (result.isIncomplete) return true
    }
    return false
  }

  public getIncompleteSources(): ISource[] {
    return this.sources.filter(s => {
      let res = this.results.get(s.name)
      return res && res.isIncomplete === true
    })
  }

  public async doComplete(): Promise<boolean> {
    let tokenSource = this.createTokenSource(false)
    let token = tokenSource.token
    let res = await Promise.all([
      this.nvim.call('coc#util#synname', []),
      this.nvim.call('coc#_suggest_variables', []),
      this.document.patchChange()
    ]) as [string, { disable: boolean, disabled_sources: string[], blacklist: string[] }, undefined]
    if (token.isCancellationRequested) return
    this.option.synname = res[0]
    let variables = res[1]
    if (variables.disable) {
      logger.warn('suggest cancelled by b:coc_suggest_disable')
      return true
    }
    if (!isFalsyOrEmpty(variables.disabled_sources)) {
      this.sources = this.sources.filter(s => !variables.disabled_sources.includes(s.name))
      if (this.sources.length === 0) {
        logger.warn('suggest cancelled by b:coc_disabled_sources')
        return true
      }
    }
    if (!isFalsyOrEmpty(variables.blacklist) && variables.blacklist.includes(this.option.input)) {
      logger.warn('suggest cancelled by b:coc_suggest_blacklist')
      return true
    }
    void WordDistance.create(this.config.localityBonus, this.option, token).then(instance => {
      this.wordDistance = instance
    })
    await waitWithToken(clamp(this.config.triggerCompletionWait, 0, MAX_TRIGGER_WAIT), tokenSource.token)
    await this.completeSources(this.sources, tokenSource, this.cid)
  }

  private async completeSources(sources: ReadonlyArray<ISource>, tokenSource: CancellationTokenSource, cid: number): Promise<void> {
    const token = tokenSource.token
    if (token.isCancellationRequested) return
    this._completing = true
    const remains: Set<string> = new Set()
    sources.forEach(s => remains.add(s.name))
    let timer: NodeJS.Timer
    let disposable: Disposable
    let tp = new Promise<void>(resolve => {
      disposable = token.onCancellationRequested(() => {
        clearTimeout(timer)
        resolve()
      })
      timer = setTimeout(() => {
        let names = Array.from(remains)
        disposable.dispose()
        tokenSource.cancel()
        logger.warn(`Completion timeout after ${this.timeout}ms`, names)
        this.nvim.setVar(`coc_timeout_sources`, names, true)
        resolve()
      }, this.timeout)
    })
    // default insert or replace range
    const range = this.getDefaultRange()
    let promises = sources.map(s => this.completeSource(s, range, token).then(added => {
      remains.delete(s.name)
      if (token.isCancellationRequested || cid != 0 || (this.cid > 0 && this._completing)) return
      if (remains.size === 0) {
        this.fireRefresh(0)
      } else if (added) {
        this.fireRefresh(16)
      }
    }))
    await Promise.race([tp, Promise.allSettled(promises)])
    this.tokenSources.delete(tokenSource)
    disposable.dispose()
    clearTimeout(timer)
    if (cid === this.cid) this._completing = false
  }

  private async completeSource(source: ISource, range: Range, token: CancellationToken): Promise<boolean> {
    // new option for each source
    let opt = Object.assign({}, this.option)
    let { asciiMatch } = this
    const insertMode = this.config.insertMode
    const sourceName = source.name
    let added = false
    try {
      if (Is.func(source.shouldComplete)) {
        let shouldRun = await Promise.resolve(source.shouldComplete(opt))
        if (!shouldRun || token.isCancellationRequested) return
      }
      const start = Date.now()
      const map = this.itemsMap
      await new Promise<void>((resolve, reject) => {
        Promise.resolve(source.doComplete(opt, token)).then(result => {
          if (token.isCancellationRequested) {
            resolve(undefined)
            return
          }
          let len = result ? result.items.length : 0
          logger.debug(`Source "${sourceName}" finished with ${len} items ms cost:`, Date.now() - start)
          if (len > 0) {
            if (Is.number(result.startcol)) {
              let line = opt.linenr - 1
              range = Range.create(line, characterIndex(opt.line, result.startcol), line, range.end.character)
            }
            const priority = getPriority(source, this.config.languageSourcePriority)
            const option: ConvertOption = { source, insertMode, priority, asciiMatch, itemDefaults: result.itemDefaults, range }
            const converter = new Converter(this.inputStart, option, opt)
            const items = result.items.reduce((items, item) => {
              let completeItem = converter.convertToDurationItem(item)
              if (!completeItem) {
                logger.error(`Unexpected completion item from ${sourceName}:`, item)
                return items
              }
              map.set(completeItem, item)
              items.push(completeItem)
              return items
            }, [])
            this.minCharacter = Math.min(this.minCharacter, converter.minCharacter)
            this.results.set(sourceName, { items, isIncomplete: result.isIncomplete === true })
            added = true
          } else {
            this.results.delete(sourceName)
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
    return added
  }

  public async completeInComplete(resumeInput: string): Promise<DurationCompleteItem[] | undefined> {
    let { document } = this
    this.cancelInComplete()
    let tokenSource = this.createTokenSource(true)
    let token = tokenSource.token
    await document.patchChange(true)
    let { input, colnr, linenr, followWord, position } = this.option
    Object.assign(this.option, {
      word: resumeInput + followWord,
      input: resumeInput,
      line: document.getline(linenr - 1),
      position: { line: position.line, character: position.character + resumeInput.length - input.length },
      colnr: colnr + (resumeInput.length - input.length),
      triggerCharacter: undefined,
      triggerForInComplete: true
    })
    this.cid++
    const sources = this.getIncompleteSources()
    await this.completeSources(sources, tokenSource, this.cid)
    if (token.isCancellationRequested) return undefined
    return this.filterItems(resumeInput)
  }

  public filterItems(input: string): DurationCompleteItem[] | undefined {
    let { results, names, option, inputStart } = this
    this._input = input
    let len = input.length
    let { maxItemCount, defaultSortMethod, removeDuplicateItems } = this.config
    let arr: DurationCompleteItem[] = []
    let words: Set<string> = new Set()
    const emptyInput = len == 0
    const lowInput = input.toLowerCase()
    const scoreFn: FuzzyScorer = (!this.config.filterGraceful || this.totalLength > 2000) ? fuzzyScore : fuzzyScoreGracefulAggressive
    const scoreOption = { boostFullMatch: true, firstMatchCanBeWeak: false }
    const anchor = Position.create(option.linenr - 1, inputStart)
    for (let name of names) {
      let result = results.get(name)
      if (!result) continue
      let items = result.items
      for (let idx = 0; idx < items.length; idx++) {
        let item = items[idx]
        let { word, filterText, dup } = item
        if (dup !== true && words.has(word)) continue
        if (removeDuplicateItems && item.isSnippet !== true && words.has(word)) continue
        let fuzzyResult: FuzzyScore | undefined
        if (!emptyInput) {
          scoreOption.firstMatchCanBeWeak = item.delta === 0 && item.character !== inputStart
          if (item.delta > 0) {
            // better input to make it have higher score and better highlight
            let prev = filterText.slice(0, item.delta)
            fuzzyResult = scoreFn(prev + input, prev + lowInput, 0, filterText, filterText.toLowerCase(), 0, scoreOption)
          } else {
            fuzzyResult = scoreFn(input, lowInput, 0, filterText, filterText.toLowerCase(), 0, scoreOption)
          }
          if (fuzzyResult == null) continue
          item.score = fuzzyResult[0]
          item.positions = fuzzyResult
          if (this.wordDistance) item.localBonus = MAX_DISTANCE - this.wordDistance.distance(anchor, item)
        } else if (item.character < inputStart) {
          let trigger = option.line.slice(item.character, inputStart)
          scoreOption.firstMatchCanBeWeak = true
          fuzzyResult = anyScore(trigger, trigger.toLowerCase(), 0, filterText, filterText.toLowerCase(), 0, scoreOption)
          item.score = fuzzyResult[0]
          item.positions = fuzzyResult
        } else {
          item.score = 0
          item.positions = undefined
        }
        words.add(word)
        arr.push(item)
      }
    }
    arr.sort(sortItems.bind(null, emptyInput, defaultSortMethod))
    return this.limitCompleteItems(arr.slice(0, maxItemCount))
  }

  public async filterResults(input: string): Promise<DurationCompleteItem[] | undefined> {
    clearTimeout(this.timer)
    if (input !== this.option.input && this.hasInComplete) {
      return await this.completeInComplete(input)
    }
    return this.filterItems(input)
  }

  private limitCompleteItems(items: DurationCompleteItem[]): DurationCompleteItem[] {
    let { highPrioritySourceLimit, lowPrioritySourceLimit } = this.config
    if (!highPrioritySourceLimit && !lowPrioritySourceLimit) return items
    let counts: Map<ISource, number> = new Map()
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

  private getDefaultRange(): Range {
    let { insertMode } = this.config
    let { linenr, followWord, position } = this.option
    let line = linenr - 1
    let end = position.character + (insertMode == InsertMode.Repalce ? followWord.length : 0)
    return Range.create(line, this.inputStart, line, end)
  }

  private createTokenSource(isIncomplete: boolean): CancellationTokenSource {
    let tokenSource = new CancellationTokenSource()
    this.tokenSources.add(tokenSource)
    tokenSource.token.onCancellationRequested(() => {
      this.tokenSources.delete(tokenSource)
    })
    this.tokensInfo.set(tokenSource, isIncomplete)
    return tokenSource
  }

  private cancelInComplete(): void {
    let { tokenSources, tokensInfo } = this
    for (let tokenSource of Array.from(tokenSources)) {
      if (tokensInfo.get(tokenSource) === true) {
        tokenSource.cancel()
      }
    }
  }

  public cancel(): void {
    let { tokenSources, timer } = this
    clearTimeout(timer)
    for (let tokenSource of Array.from(tokenSources)) {
      tokenSource.cancel()
    }
    tokenSources.clear()
    this._completing = false
  }

  public dispose(): void {
    this.cancel()
    this.results.clear()
    this._onDidRefresh.dispose()
  }
}

export function sortItems(emptyInput: boolean, defaultSortMethod: SortMethod, a: DurationCompleteItem, b: DurationCompleteItem): number {
  let sa = a.sortText
  let sb = b.sortText
  if (a.score !== b.score) return b.score - a.score
  if (a.priority !== b.priority) return b.priority - a.priority
  if (a.source === b.source && sa !== sb) return sa < sb ? -1 : 1
  if (a.localBonus !== b.localBonus) return b.localBonus - a.localBonus
  // not sort with empty input, the item not replace trigger have higher priority
  if (emptyInput) return b.character - a.character
  switch (defaultSortMethod) {
    case SortMethod.None:
      return 0
    case SortMethod.Alphabetical:
      return a.filterText.localeCompare(b.filterText)
    case SortMethod.Length:
    default: // Fallback on length
      return a.filterText.length - b.filterText.length
  }
}
