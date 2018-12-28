import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import Increment from './increment'
import Complete from './complete'
import Document from '../model/document'
import sources from '../sources'
import { CompleteConfig, CompleteOption, RecentScore, VimCompleteItem, WorkspaceConfiguration } from '../types'
import { disposeAll, wait } from '../util'
import { byteSlice, byteLength, isWord } from '../util/string'
import workspace from '../workspace'
const logger = require('../util/logger')('completion')

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  // current input string
  private input: string
  private document: Document
  private increment: Increment
  private lastInsert?: LastInsert
  private lastChangedI: number
  private insertMode = false
  private nvim: Neovim
  private completing = false
  private disposables: Disposable[] = []
  private _completeItems: VimCompleteItem[] = []
  private complete: Complete | null = null
  private recentScores: RecentScore = {}
  private preferences: WorkspaceConfiguration
  private triggerCharacters: Set<string> = new Set()
  private changedTick = 0
  private currIndex = 0

  constructor() {
    this.preferences = workspace.getConfiguration('coc.preferences')
    let noselect = this.preferences.get<boolean>('noselect')
    if (!noselect) this.currIndex = 1

    workspace.onDidChangeConfiguration(_e => {
      this.preferences = workspace.getConfiguration('coc.preferences')
    }, null, this.disposables)
  }

  public get option(): CompleteOption {
    if (!this.complete) return null
    return this.complete.option
  }

  public get resolving(): boolean {
    return this.currIndex !== 0
  }

  public getPreference(key: string): any {
    return this.preferences.get(key)
  }

  // vim's logic for filter items
  public filterItemsVim(input: string): VimCompleteItem[] {
    return this._completeItems.filter(item => {
      return item.word.startsWith(input)
    })
  }

  // TODO this is incorrect sometimes
  private getCompleteItem(word: string): VimCompleteItem | null {
    let items = this._completeItems || []
    let idx = items.findIndex(o => o.word == word)
    this.currIndex = idx + 1
    if (idx == -1) return null
    return items[idx]
  }

  public get index(): number {
    return this.currIndex
  }

  private addRecent(word: string, bufnr: number): void {
    if (!word) return
    this.recentScores[`${bufnr}|${word}`] = Date.now()
  }

  public async getResumeInput(): Promise<string> {
    let { option, increment, document } = this
    if (!document || !option) return null
    let [, lnum, col] = await this.nvim.call('getcurpos')
    if (lnum != option.linenr || col < option.col + 1) {
      increment.stop()
      return null
    }
    let line = document.getline(lnum - 1)
    return byteSlice(line, option.col, col - 1)
  }

  private get bufnr(): number {
    let { option } = this
    return option ? option.bufnr : null
  }

  public init(nvim: Neovim): void {
    this.nvim = nvim
    let increment = this.increment = new Increment(nvim, this.numberSelect)
    this.disposables.push(events.on('InsertCharPre', this.onInsertCharPre, this))
    this.disposables.push(events.on('InsertLeave', this.onInsertLeave, this))
    this.disposables.push(events.on('InsertEnter', this.onInsertEnter, this))
    this.disposables.push(events.on('TextChangedP', this.onTextChangedP, this))
    this.disposables.push(events.on('TextChangedI', this.onTextChangedI, this))
    this.disposables.push(events.on('CompleteDone', this.onCompleteDone, this))
    nvim.mode.then(({ mode }) => {
      this.insertMode = mode.startsWith('i')
    }) // tslint:disable-line
    // stop change emit on completion
    increment.on('start', () => {
      let noselect = this.preferences.get<boolean>('noselect')
      this.currIndex = noselect ? 0 : 1
      this.changedTick = 0
      this._completeItems = []
      this.document.paused = true
    })
    increment.on('stop', () => {
      this.document.paused = false
      this.complete = null
    })
  }

  public get isActivted(): boolean {
    return this.increment.isActivted
  }

  private getCompleteConfig(): CompleteConfig {
    let config = workspace.getConfiguration('coc.preferences')
    return {
      maxItemCount: config.get<number>('maxCompleteItemCount', 50),
      timeout: config.get<number>('timeout', 500),
      snippetIndicator: config.get<string>('snippetIndicator', '~'),
      fixInsertedWord: config.get<boolean>('fixInsertedWord', true),
      localityBonus: config.get<boolean>('localityBonus', true)
    }
  }

  public get hasLatestChangedI(): boolean {
    let { lastChangedI } = this
    return lastChangedI && Date.now() - lastChangedI < 100
  }

  public async startCompletion(option: CompleteOption): Promise<void> {
    let document = workspace.getDocument(option.bufnr)
    if (!document) return
    this.document = document
    option.filetype = document.filetype
    // current input
    this.input = option.input
    this.triggerCharacters = sources.getTriggerCharacters(option.filetype)
    if (this.completing) return
    this.completing = true
    try {
      await this._doComplete(option)
      this.completing = false
    } catch (e) {
      this.completing = false
      this.increment.stop()
      workspace.showMessage(`Error happens on complete: ${e.message}`, 'error')
      logger.error(e.stack)
    }
  }

  private async resumeCompletion(resumeInput: string, _isChangedP = false): Promise<void> {
    let { nvim, increment, document, complete, insertMode } = this
    if (!complete || !complete.results) return
    let { changedtick } = document
    this.input = resumeInput
    let items: VimCompleteItem[]
    if (complete.isIncomplete) {
      await document.patchChange()
      document.forceSync()
      await wait(30)
      if (document.changedtick != changedtick) return
      items = await complete.completeInComplete(resumeInput)
      if (document.changedtick != changedtick) return
    } else {
      items = complete.filterResults(resumeInput)
    }
    if (!this.isActivted) return
    let { col } = this.option
    if (!insertMode || !items || items.length === 0) {
      this._completeItems = []
      this.nvim.call('coc#_hide', [], true)
      increment.stop()
      return
    }
    this.appendNumber(items)
    this.changedTick = document.changedtick
    nvim.call('coc#_do_complete', [col, items], true)
    this._completeItems = items
    await this.onPumVisible()
  }

  private appendNumber(items: VimCompleteItem[]): void {
    if (!this.numberSelect) return
    for (let i = 1; i <= 10; i++) {
      let item = items[i - 1]
      if (!item) break
      let idx = i == 10 ? 0 : i
      item.abbr = item.abbr ? `${idx} ${item.abbr}` : `${idx} ${item.word}`
    }
  }

  private async onPumVisible(): Promise<void> {
    let first = this._completeItems[0]
    let noselect = this.preferences.get<boolean>('noselect')
    if (!noselect) await sources.doCompleteResolve(first)
  }

  public hasSelected(): boolean {
    return this.currIndex != 0
  }

  private async _doComplete(option: CompleteOption): Promise<void> {
    let { linenr, line } = option
    let { nvim, increment } = this
    let arr = sources.getCompleteSources(option, this.triggerCharacters.has(option.triggerCharacter))
    let config = this.getCompleteConfig()
    let document = workspace.getDocument(option.bufnr)
    this.complete = new Complete(option, document, this.recentScores, config, nvim)
    increment.start(option)
    let items = await this.complete.doComplete(arr)
    if (items.length == 0 || !this.insertMode) {
      increment.stop()
      return
    }
    // changedtick could change without content change
    if (this.document.getline(linenr - 1) == line) {
      this.appendNumber(items)
      this.changedTick = document.changedtick
      nvim.call('coc#_do_complete', [option.col, items], true)
      this._completeItems = items
      await this.onPumVisible()
      return
    }
    let search = await this.getResumeInput()
    if (search == null) return
    await this.resumeCompletion(search)
  }

  private async onTextChangedP(): Promise<void> {
    let { increment, option, document } = this
    if (document) await document.patchChange()
    // filtered by remove character
    if (!document || !option || this.completing || !this.isActivted) return
    // neovim would trigger TextChangedP after fix of word
    // avoid trigger filter on pumvisible
    if (document.changedtick == this.changedTick) return
    let { latestInsert } = this
    this.lastInsert = null
    let col = await this.nvim.call('col', ['.'])
    if (col < option.colnr) {
      increment.stop()
      return null
    }
    let idx = option.linenr - 1
    let line = this.document.getline(idx)
    let search = byteSlice(line, option.col, col - 1)
    if (latestInsert) {
      await this.resumeCompletion(search, true)
      return
    }
    let item = this.getCompleteItem(search)
    if (item) {
      if (item.isSnippet) {
        let { word } = item
        let text = word.match(/^[\w\-$.@#:"]*/)[0]
        if (word != text) {
          let before = byteSlice(line, 0, option.col)
          let after = byteSlice(line, option.col + byteLength(word))
          line = `${before}${text}${after}`
          if (workspace.isNvim) this.changedTick = document.changedtick + 1
          this.nvim.pauseNotification()
          this.nvim.call('coc#util#setline', [option.linenr, line], true)
          this.nvim.call('cursor', [option.linenr, col - byteLength(word.slice(text.length))], true)
          if (workspace.isVim) {
            await document.patchChange()
          }
          this.nvim.resumeNotification()
        }
      }
      await sources.doCompleteResolve(item)
    }
  }

  private async onTextChangedI(bufnr: number): Promise<void> {
    this.lastChangedI = Date.now()
    if (this.completing) return
    let { nvim, increment, document, input, latestInsertChar } = this
    this.lastInsert = null
    if (increment.isActivted) {
      if (bufnr !== this.bufnr) return
      if (latestInsertChar) await document.patchChange()
      let checkCommit = this.preferences.get<boolean>('acceptSuggestionOnCommitCharacter', false)
      if (checkCommit
        && latestInsertChar
        && !isWord(latestInsertChar)
        && !this.resolving
        && this._completeItems.findIndex(o => o.word == input) == -1) {
        let item = this._completeItems[0]
        if (sources.shouldCommit(item, latestInsertChar)) {
          let { linenr, col, line, colnr } = this.option
          this.nvim.call('coc#_hide', [], true)
          increment.stop()
          let { word } = item
          let newLine = `${line.slice(0, col)}${word}${latestInsertChar}${line.slice(colnr - 1)}`
          await nvim.call('coc#util#setline', [linenr, newLine])
          let curcol = col + word.length + 2
          await nvim.call('cursor', [linenr, curcol])
        }
      }
      if (latestInsertChar && this.triggerCharacters.has(latestInsertChar)) {
        this.nvim.call('coc#_hide', [], true)
        increment.stop()
        await this.triggerCompletion(latestInsertChar)
        return
      }
      let search = await this.getResumeInput()
      if (search == input || !increment.isActivted) return
      if (search == null
        || search.endsWith(' ')
        || search.length < this.option.input.length) {
        increment.stop()
        return
      }
      return await this.resumeCompletion(search)
    }
    if (!latestInsertChar) return
    await this.triggerCompletion(latestInsertChar)
  }

  private async triggerCompletion(character: string): Promise<void> {
    // check trigger
    let shouldTrigger = await this.shouldTrigger(character)
    if (!shouldTrigger) return
    let option: CompleteOption = await this.nvim.call('coc#util#get_complete_option')
    option.triggerCharacter = character
    logger.debug('trigger completion with', option)
    await this.startCompletion(option)
  }

  private async onCompleteDone(item: VimCompleteItem): Promise<void> {
    let { increment, document, nvim } = this
    if (!this.isActivted || !document) return
    item = this._completeItems.find(o => o.word == item.word && o.user_data == item.user_data)
    if (!item) return
    let opt = Object.assign({}, this.option)
    let { changedtick } = document
    try {
      increment.stop()
      await sources.doCompleteResolve(item)
      this.addRecent(item.word, document.bufnr)
      await wait(40)
      await document.patchChange()
      if (changedtick != document.changedtick) return
      document.forceSync()
      let { mode } = await nvim.mode
      if (mode != 'i') return
      await sources.doCompleteDone(item, opt)
    } catch (e) {
      // tslint:disable-next-line:no-console
      console.error(e.stack)
      logger.error(`error on complete done`, e.stack)
    }
  }

  private async onInsertLeave(): Promise<void> {
    this.insertMode = false
    this.nvim.call('coc#_hide', [], true)
    this.increment.stop()
  }

  private async onInsertEnter(): Promise<void> {
    this.insertMode = true
    let trigger = this.preferences.get<boolean>('triggerAfterInsertEnter', false)
    if (!trigger || this.completing) return
    let minLength = this.preferences.get<number>('minTriggerInputLength', 1)
    let option = await this.nvim.call('coc#util#get_complete_option')
    if (option.input.length >= minLength) {
      await this.startCompletion(option)
    }
  }

  private async onInsertCharPre(character: string): Promise<void> {
    this.lastInsert = {
      character,
      timestamp: Date.now(),
    }
    if (workspace.isNvim &&
      this.isActivted &&
      !global.hasOwnProperty('__TEST__') &&
      !this.triggerCharacters.has(character)) {
      this.nvim.call('coc#_reload', [], true)
    }
  }

  private get latestInsert(): LastInsert | null {
    let { lastInsert } = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > 80) {
      return null
    }
    return lastInsert
  }

  private get latestInsertChar(): string {
    let { latestInsert } = this
    if (!latestInsert) return ''
    return latestInsert.character
  }

  public async shouldTrigger(character: string): Promise<boolean> {
    if (!character || character == ' ') return false
    let autoTrigger = this.preferences.get<string>('autoTrigger', 'always')
    if (autoTrigger == 'none') return false
    let doc = await workspace.document
    if (sources.shouldTrigger(character, doc.filetype)) return true
    if (autoTrigger !== 'always') return false
    if (doc.isWord(character)) {
      if (character <= '9' && character >= '0' && this.numberSelect) {
        return false
      }
      let minLength = this.preferences.get<number>('minTriggerInputLength', 1)
      let input = await this.nvim.call('coc#util#get_input') as string
      return input.length >= minLength
    }
    return false
  }

  private get numberSelect(): boolean {
    return this.preferences.get<boolean>('numberSelect', false)
  }

  public get completeItems(): VimCompleteItem[] {
    return this._completeItems
  }

  public dispose(): void {
    if (this.increment) {
      this.increment.removeAllListeners()
      this.increment.stop()
    }
    disposeAll(this.disposables)
  }
}

export default new Completion()
