'use strict'
import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import { defaultValue, disposeAll, getConditionValue, waitImmediate } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { ASCII_END } from '../util/constants'
import { caseMatch, fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { unidecode } from '../util/node'
import { CancellationToken, Disposable } from '../util/protocol'
import * as Is from '../util/is'
import { isAlphabet } from '../util/string'
import workspace from '../workspace'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource, SourceConfig, SourceType } from './types'
import { DocumentSelector } from '../provider'
const WORD_PREFIXES = ['_', '$', '-']
const WORD_PREFIXES_CODE = [95, 36, 45]
const MAX_DURATION = getConditionValue(80, 20)
const MAX_COUNT = 50

export interface SourceConfiguration {
  readonly priority?: number
  readonly triggerCharacters?: string[]
  readonly firstMatch?: boolean
  readonly triggerPatterns?: string[]
  readonly shortcut?: string
  readonly enable?: boolean
  readonly filetypes?: string[]
  readonly disableSyntaxes?: string[]
}

export default class Source implements ISource<ExtendedCompleteItem> {
  public readonly name: string
  public readonly filepath: string
  public readonly sourceType: SourceType
  public readonly isSnippet: boolean
  public readonly documentSelector: DocumentSelector | undefined
  /**
   * Words that not match during session
   * The word that not match previous input would not match further input
   */
  protected noMatchWords: Set<string> = new Set()
  private config: SourceConfiguration
  private disposables: Disposable[] = []
  private _disabled = false
  private defaults: Partial<SourceConfig>
  constructor(option: Partial<SourceConfig>) {
    // readonly properties
    this.name = option.name
    this.filepath = option.filepath || ''
    this.sourceType = option.sourceType || SourceType.Native
    this.isSnippet = !!option.isSnippet
    this.defaults = option
    this.documentSelector = option.documentSelector
    const key = `coc.source.${option.name}`
    this.config = defaultValue(workspace.initialConfiguration.get(key) as SourceConfiguration, {})
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(key)) {
        this.config = defaultValue(workspace.initialConfiguration.get(key) as SourceConfiguration, {})
      }
    }, null, this.disposables)
    events.on('CompleteDone', () => {
      this.noMatchWords.clear()
    }, null, this.disposables)
  }

  protected get nvim(): Neovim {
    return workspace.nvim
  }

  /**
   * Priority of source, higher priority makes items lower index.
   */
  public get priority(): number {
    return this.getConfig('priority', 1)
  }

  public get triggerPatterns(): RegExp[] | null {
    let patterns = this.getConfig<string[]>('triggerPatterns', null)
    if (isFalsyOrEmpty(patterns)) return null
    return patterns.map(s => Is.string(s) ? new RegExp(s + '$') : s)
  }

  /**
   * When triggerOnly is true, not trigger completion on keyword character insert.
   */
  public get triggerOnly(): boolean {
    let triggerOnly = this.defaults['triggerOnly']
    if (Is.boolean(triggerOnly)) return triggerOnly
    return Array.isArray(this.triggerPatterns) && this.triggerPatterns.length > 0
  }

  public get triggerCharacters(): string[] {
    return toArray(this.getConfig('triggerCharacters', []))
  }

  public get firstMatch(): boolean {
    return this.getConfig('firstMatch', true)
  }

  // exists opitonnal function names for remote source
  public get optionalFns(): string[] {
    return this.defaults['optionalFns'] || []
  }

  public get shortcut(): string {
    let shortcut = this.getConfig('shortcut', '')
    return shortcut ? shortcut : this.name.slice(0, 3)
  }

  public get enable(): boolean {
    if (this._disabled) return false
    return this.getConfig('enable', true)
  }

  public get filetypes(): string[] | null {
    return this.getConfig('filetypes', null)
  }

  public get disableSyntaxes(): string[] {
    return this.getConfig('disableSyntaxes', [])
  }

  public getConfig<T>(key: string, defaultValue?: T): T | null {
    let val = this.config[key]
    if (Is.func(val) || val == null) return defaultValue ?? null
    return val as T
  }

  public toggle(): void {
    this._disabled = !this._disabled
  }

  public get menu(): string {
    return ''
  }

  public async checkComplete(opt: CompleteOption): Promise<boolean> {
    let { disableSyntaxes } = this
    if (!isFalsyOrEmpty(disableSyntaxes) && opt.synname) {
      let synname = opt.synname.toLowerCase()
      if (disableSyntaxes.findIndex(s => synname.includes(s.toLowerCase())) !== -1) {
        return false
      }
    }
    let fn = this.defaults['shouldComplete']
    if (Is.func(fn)) return !!(await Promise.resolve(fn.call(this, opt)))
    return true
  }

  public async refresh(): Promise<void> {
    let fn = this.defaults['refresh']
    if (Is.func(fn)) await Promise.resolve(fn.call(this))
  }

  public async onCompleteDone(item: ExtendedCompleteItem, opt: CompleteOption): Promise<void> {
    let fn = this.defaults['onCompleteDone']
    if (Is.func(fn)) await Promise.resolve(fn.call(this, item, opt))
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult<ExtendedCompleteItem> | null> {
    let shouldRun = await this.checkComplete(opt)
    if (!shouldRun || token.isCancellationRequested) return null
    let fn = this.defaults['doComplete']
    return await Promise.resolve(fn.call(this, opt, token))
  }

  public async onCompleteResolve(item: ExtendedCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    let fn = this.defaults['onCompleteResolve']
    if (Is.func(fn)) await Promise.resolve(fn.call(this, item, opt, token))
  }

  /**
   * Add words to items with timer.
   */
  public async getResults(iterables: Iterable<string>[], input: string, exclude: string, items: Set<string>, token: CancellationToken): Promise<boolean> {
    let { firstMatch, noMatchWords } = this
    let start = Date.now()
    let prev = start
    let len = input.length
    let firstCode = input.charCodeAt(0)
    let codes = getCharCodes(input)
    let ascii = isAlphabet(firstCode)
    let i = 0
    for (let iterable of iterables) {
      for (let w of iterable) {
        i++
        if (i % 100 === 0) {
          let curr = Date.now()
          if (curr - prev > 15) {
            await waitImmediate()
            prev = curr
          }
          if (token.isCancellationRequested || curr - start > MAX_DURATION) return true
        }
        if ((w.length <= 1 && w.charCodeAt(0) < 255) || w === exclude || items.has(w) || noMatchWords.has(w)) continue
        if (firstMatch && !firstMatchFuzzy(firstCode, ascii, w)) {
          noMatchWords.add(w)
          continue
        }
        if (len > 1) {
          let matched = fuzzyMatch(codes, ascii && w[0].charCodeAt(0) > ASCII_END ? unidecode(w) : w)
          if (!matched) {
            noMatchWords.add(w)
            continue
          }
        }
        items.add(w)
        if (items.size == MAX_COUNT) return true
      }
    }
    return false
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export function firstMatchFuzzy(firstCode: number, ascii: boolean, word: string) {
  let ch = word[0]
  if (ascii && !WORD_PREFIXES_CODE.includes(firstCode) && WORD_PREFIXES.includes(ch)) ch = word[1]
  if (ascii && ch.charCodeAt(0) > ASCII_END) ch = unidecode(ch)
  return caseMatch(firstCode, ch.charCodeAt(0))
}
