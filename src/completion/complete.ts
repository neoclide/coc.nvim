import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Emitter, Event, Position } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, FloatConfig, ISource, VimCompleteItem } from '../types'
import { getCharCodes } from '../util/fuzzy'
import { byteSlice, characterIndex } from '../util/string'
import { matchScore } from './match'
const logger = require('../util/logger')('completion-complete')

export interface MruItem {
  prefix: string
  label: string
  source: string
}

export interface CompleteConfig {
  selection: 'none' | 'recentlyUsed' | 'recentlyUsedByPrefix'
  disableKind: boolean
  disableMenu: boolean
  disableMenuShortcut: boolean
  enablePreview: boolean
  enablePreselect: boolean
  labelMaxLength: number
  floatEnable: boolean
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
  floatConfig: FloatConfig
}

export type Callback = () => void

// first time completion
const FIRST_TIMEOUT = 500

export default class Complete {
  // identify this complete
  private results: Map<string, CompleteResult> = new Map()
  private completing: Set<string> = new Set()
  private _canceled = false
  private localBonus: Map<string, number>
  private tokenSources: Map<string, CancellationTokenSource> = new Map()
  private readonly _onDidComplete = new Emitter<void>()
  public readonly onDidComplete: Event<void> = this._onDidComplete.event
  constructor(public option: CompleteOption,
    private document: Document,
    private config: CompleteConfig,
    private sources: ReadonlyArray<ISource>,
    private mruItems: ReadonlyArray<MruItem>,
    private nvim: Neovim) {
  }

  public get isCompleting(): boolean {
    return this.completing.size > 0
  }

  public get isCanceled(): boolean {
    return this._canceled
  }

  public get isEmpty(): boolean {
    return this.results.size == 0
  }

  public get startcol(): number {
    return this.option.col || 0
  }

  public get input(): string {
    return this.option.input
  }

  public get isIncomplete(): boolean {
    return Array.from(this.results.values()).findIndex(o => o.isIncomplete) !== -1
  }

  private async completeSource(source: ISource, cid = 0): Promise<void> {
    let { col } = this.option
    // new option for each source
    let opt = Object.assign({}, this.option)
    let { timeout, fixInsertedWord, snippetIndicator } = this.config
    timeout = Math.max(Math.min(timeout, 15000), 500)
    let followPart = !fixInsertedWord ? '' : this.getFollowPart()
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
          if (result && result.items) {
            result.priority = source.priority
            // make sure word exists.
            result.items = result.items.filter(o => o && typeof o.word === 'string')
            if (!result.items.length) {
              this.results.delete(name)
            } else {
              result.items.forEach((item, idx) => {
                item.source = name
                item.priority = source.priority
                item.filterText = item.filterText || item.word
                item.abbr = item.abbr || item.word
                if (followPart.length && !item.isSnippet && item.word.endsWith(followPart)) {
                  item.word = item.word.slice(0, - followPart.length)
                }
                if (item.isSnippet && !item.abbr.endsWith(snippetIndicator)) {
                  item.abbr = `${item.abbr}${snippetIndicator}`
                }
                item.localBonus = this.localBonus ? this.localBonus.get(item.filterText) || 0 : 0
                let user_data: any = { source: name, cid }
                user_data.index = item.index || idx
                if (item.signature) user_data.signature = item.signature
                item.user_data = JSON.stringify(user_data)
              })
              // lazy completed items
              if (empty && result.startcol && result.startcol != col) {
                this.results.clear()
                this.results.set(name, result)
              } else {
                this.results.set(name, result)
              }
              if (empty) this._onDidComplete.fire()
            }
            resolve(undefined)
          } else {
            this.results.delete(name)
            resolve(undefined)
          }
        }, err => {
          this.completing.delete(name)
          onFinished()
          reject(err)
        })
      })
    } catch (err) {
      this.nvim.echoError(`Complete ${source.name} error: ${err.message.replace(/'/g, "''")}`)
      logger.error('Complete error:', source.name, err)
    }
  }

  public async completeInComplete(resumeInput: string): Promise<ExtendedCompleteItem[]> {
    let { results, document } = this
    let names: string[] = []
    for (let [source, result] of results.entries()) {
      if (result.isIncomplete) names.push(source)
    }
    let { input, colnr, linenr } = this.option
    Object.assign(this.option, {
      input: resumeInput,
      line: document.getline(linenr - 1),
      colnr: colnr + (resumeInput.length - input.length),
      triggerCharacter: null,
      triggerForInComplete: true
    })
    let sources = this.sources.filter(s => names.includes(s.name))
    let cid = Math.floor(Date.now() / 1000)
    await Promise.all(sources.map(s => this.completeSource(s, cid)))
    return this.filterResults(resumeInput)
  }

  public filterResults(input: string): ExtendedCompleteItem[] {
    let { results } = this
    if (results.size == 0) return []
    let resultList = Array.from(results.values()).sort((a, b) => b.priority - a.priority)
    let { maxItemCount, enablePreselect, defaultSortMethod, removeDuplicateItems } = this.config
    let arr: ExtendedCompleteItem[] = []
    let codes = getCharCodes(input)
    let words: Set<string> = new Set()
    for (let i = 0, l = resultList.length; i < l; i++) {
      let { items } = resultList[i]
      for (let idx = 0; idx < items.length; idx++) {
        let item = items[idx]
        let { word, filterText, dup } = item
        if (dup !== 1 && words.has(word)) continue
        if (filterText.length < input.length) continue
        if (removeDuplicateItems && !item.isSnippet && words.has(word) && item.line === undefined) continue
        let score = item.kind && filterText == input ? 64 : matchScore(filterText, codes)
        if (input.length > 0 && score === 0) continue
        if (input.length > 0 && item.isSnippet && item.word === input) {
          item.score = 99
        } else {
          item.score = input.length ? score * (item.sourceScore || 1) : 0
        }
        words.add(word)
        arr.push(item)
      }
    }
    arr.sort((a, b) => {
      let sa = a.sortText
      let sb = b.sortText
      if (a.score !== b.score) return b.score - a.score
      if (a.source === b.source && sa !== sb) return sa < sb ? -1 : 1
      if (a.priority !== b.priority) return b.priority - a.priority
      if (a.localBonus !== b.localBonus) return b.localBonus - a.localBonus
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
    let recentIndex = this.getRecentIndex(input, arr)
    if (recentIndex !== undefined && !this.nvim.isVim) {
      if (enablePreselect && !this.nvim.isVim) {
        arr[recentIndex].preselect = true
      } else {
        let [item] = arr.splice(recentIndex, 1)
        arr.unshift(item)
      }
    }
    return this.limitCompleteItems(arr.slice(0, maxItemCount))
  }

  private getRecentIndex(input: string, items: ExtendedCompleteItem[]): number | undefined {
    let { selection } = this.config
    if (selection == 'none' || !this.mruItems.length) return undefined
    let res: number | undefined
    let minimalIndex: number | undefined
    let mruMap: Map<string, number> = new Map()
    for (let i = this.mruItems.length - 1; i >= 0; i--) {
      let o = this.mruItems[i]
      let key = `${selection === 'recentlyUsedByPrefix' ? o.prefix : ''}|${o.source}|${o.label}`
      mruMap.set(key, i)
    }
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      if (selection === 'recentlyUsed' && input.length && !item.filterText.startsWith(input)) continue
      let key = `${selection === 'recentlyUsedByPrefix' ? input : ''}|${item.source}|${item.filterText}`
      let idx = mruMap.get(key)
      if (idx === undefined) continue
      if (minimalIndex === undefined || idx < minimalIndex) {
        minimalIndex = idx
        res = i
      }
      if (idx === 0) {
        break
      }
    }
    return res
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
    for (let [source, result] of results.entries()) {
      if (result.startcol == null || result.startcol === col) continue
      let { startcol } = result
      opts.col = startcol
      opts.input = byteSlice(line, startcol, colnr - 1)
      results.clear()
      results.set(source, result)
      break
    }
    logger.info(`${results.size} results from: ${Array.from(results.keys()).join(',')}`)
    return results.size > 0 ? this.filterResults(opts.input) : []
  }

  public resolveCompletionItem(item: VimCompleteItem | undefined): ExtendedCompleteItem | null {
    if (!item?.user_data) return null
    try {
      let obj = JSON.parse(item.user_data)
      if (!obj) return null
      let res = this.results.get(obj.source)
      return res ? res.items.find(o => o.user_data == item.user_data) : null
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
    this.results.clear()
  }
}
