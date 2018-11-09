import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from './events'
import Increment from './increment'
import Complete from './model/complete'
import Document from './model/document'
import sources from './sources'
import { CompleteConfig, CompleteOption, RecentScore, VimCompleteItem, WorkspaceConfiguration } from './types'
import { disposeAll, wait } from './util'
import { isCocItem } from './util/complete'
import { byteSlice } from './util/string'
import workspace from './workspace'
const logger = require('./util/logger')('completion')

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  // current input string
  private input: string
  private increment: Increment
  private lastInsert?: LastInsert
  private lastChangedI: number
  private lastPumvisible = 0
  private insertMode = false
  private nvim: Neovim
  private completing = false
  private resolving = false
  private disposables: Disposable[] = []
  private completeItems: VimCompleteItem[] = []
  private complete: Complete | null = null
  private recentScores: RecentScore = {}
  private option: CompleteOption = null
  private preferences: WorkspaceConfiguration
  private triggerCharacters: Set<string> = new Set()

  constructor() {
    this.preferences = workspace.getConfiguration('coc.preferences')

    workspace.onDidChangeConfiguration(_e => {
      this.preferences = workspace.getConfiguration('coc.preferences')
    }, null, this.disposables)
  }

  // vim's logic for filter items
  private filterItemsVim(input: string): VimCompleteItem[] {
    return this.completeItems.filter(item => {
      return item.word.startsWith(input)
    })
  }

  // TODO this is incorrect sometimes
  private getCompleteItem(word: string): VimCompleteItem | null {
    let { completeItems } = this
    if (!completeItems) return null
    return completeItems.find(o => o.word == word)
  }

  private addRecent(word: string): void {
    if (!word || !this.option) return
    let { input } = this.option
    if (!input.length) return
    let key = `${input.slice(0, 1)}|${word}`
    let val = this.recentScores[key]
    if (!val) {
      this.recentScores[key] = 0.01
    } else {
      this.recentScores[key] = Math.min(val + 0.01, 0.1)
    }
  }

  private get document(): Document {
    let { option } = this
    if (!option) return null
    return workspace.getDocument(option.bufnr)
  }

  private async getResumeInput(): Promise<string> {
    let { option, increment, document } = this
    if (!document) return null
    let [, lnum, col] = await this.nvim.call('getcurpos')
    if (lnum != option.linenr || col < option.col + 1) {
      increment.stop()
      return null
    }
    let line: string
    if (workspace.isVim) {
      line = await this.nvim.call('getline', '.')
    } else {
      line = document.getline(lnum - 1)
    }
    return byteSlice(line, option.col, col - 1)
  }

  private get bufnr(): number {
    let { option } = this
    return option ? option.bufnr : null
  }

  // private get input(): string {
  //   let { option } = this
  //   return option ? option.input : null
  // }

  public init(nvim: Neovim): void {
    this.nvim = nvim
    let increment = this.increment = new Increment(nvim)
    this.disposables.push(events.on('InsertCharPre', this.onInsertCharPre, this))
    this.disposables.push(events.on('InsertLeave', this.onInsertLeave, this))
    this.disposables.push(events.on('InsertEnter', this.onInsertEnter, this))
    this.disposables.push(events.on('TextChangedP', this.onTextChangedP, this))
    this.disposables.push(events.on('TextChangedI', this.onTextChangedI, this))
    this.disposables.push(events.on('CompleteDone', this.onCompleteDone, this))
    nvim.mode.then(({ mode }) => {
      this.insertMode = mode.startsWith('i')
    }, _e => {
      // noop
    })
    // stop change emit on completion
    increment.on('start', () => {
      this.resolving = false
      this.completeItems = []
      this.document.paused = true
    })
    increment.on('stop', () => {
      this.document.paused = false
      this.option = null
    })
  }

  public get isActivted(): boolean {
    return this.increment.isActivted
  }

  private getCompleteConfig(): CompleteConfig {
    let config = workspace.getConfiguration('coc.preferences')
    return {
      maxItemCount: config.get<number>('maxCompleteItemCount', 50),
      timeout: config.get<number>('timeout', 500)
    }
  }

  public get hasLatestChangedI(): boolean {
    let { lastChangedI } = this
    return lastChangedI && Date.now() - lastChangedI < 100
  }

  public startCompletion(option: CompleteOption): void {
    let document = workspace.getDocument(option.bufnr)
    if (!document) return
    option.filetype = document.filetype
    this.option = option
    this.input = option.input
    this.triggerCharacters = sources.getTriggerCharacters(option.filetype, option.custom)
    if (this.document == null || this.completing) return
    this.completing = true
    this._doComplete(option).then(() => {
      this.completing = false
    }).catch(e => {
      this.increment.stop()
      this.completing = false
      workspace.showMessage(`Error happens on complete: ${e.message}`, 'error')
      logger.error('', e.stack)
    })
  }

  private async resumeCompletion(resumeInput: string, isChangedP = false): Promise<void> {
    let { nvim, increment, option, complete, insertMode } = this
    if (!complete || !complete.results) return
    this.input = resumeInput
    let items = complete.filterResults(resumeInput)
    if (!insertMode || !items || items.length === 0) {
      this.nvim.call('coc#_hide', [], true)
      increment.stop()
      return
    }
    if (isChangedP) {
      let filtered = this.filterItemsVim(resumeInput)
      if (filtered.length == items.length) {
        return
      }
    }
    nvim.call('coc#_set_context', [option.col, items], true)
    this.completeItems = items
    await nvim.call('coc#_do_complete', [])
    await this.onPumVisible()
  }

  private async onPumVisible(): Promise<void> {
    this.lastPumvisible = Date.now()
    let first = this.completeItems[0]
    let noselect = this.preferences.get<boolean>('noselect')
    if (!noselect) await sources.doCompleteResolve(first)
  }

  private async _doComplete(option: CompleteOption): Promise<void> {
    let { linenr, line } = option
    let { nvim, increment, document } = this
    increment.start()
    let arr = sources.getCompleteSources(option, this.triggerCharacters.has(option.triggerCharacter))
    let config = this.getCompleteConfig()
    this.complete = new Complete(option, this.recentScores, config, nvim)
    let items = await this.complete.doComplete(arr)
    if (items.length == 0 || !this.insertMode) {
      increment.stop()
      return
    }
    // changedtick could change without content change
    if (document.getline(linenr - 1) == line) {
      nvim.call('coc#_set_context', [option.col, items], true)
      this.completeItems = items
      await nvim.call('coc#_do_complete', [])
      await this.onPumVisible()
      return
    }
    let search = await this.getResumeInput()
    if (search == null) return
    await this.resumeCompletion(search)
  }

  private async onTextChangedP(): Promise<void> {
    let { increment, input } = this
    if (Math.abs(Date.now() - this.lastPumvisible) < 10) return
    if (this.hasLatestChangedI || this.completing || !increment.isActivted) return
    let { latestInsert } = this
    this.lastInsert = null
    let search = await this.getResumeInput()
    if (search == null || input == search) return
    if (latestInsert) {
      await this.resumeCompletion(search, true)
      return
    }
    let item = this.getCompleteItem(search)
    if (item) {
      this.resolving = true
      await sources.doCompleteResolve(item)
    }
  }

  private async onTextChangedI(bufnr: number): Promise<void> {
    this.lastChangedI = Date.now()
    if (this.completing) return
    let { nvim, increment, document, input, latestInsertChar } = this
    if (increment.isActivted) {
      if (bufnr !== this.bufnr) return
      let checkCommit = this.preferences.get<boolean>('acceptSuggestionOnCommitCharacter', false)
      if (checkCommit && latestInsertChar && !document.isWord(latestInsertChar) && !this.resolving) {
        let item = this.completeItems[0]
        if (item.word != input && sources.shouldCommit(item, latestInsertChar)) {
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
      if (search == null || search.length < this.option.input.length) {
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
    logger.trace('trigger completion with', option)
    this.startCompletion(option)
  }

  private async onCompleteDone(item: VimCompleteItem): Promise<void> {
    let { increment, document } = this
    if (!this.isActivted || !document || !isCocItem(item)) return
    let { col } = this.option
    try {
      increment.stop()
      this.addRecent(item.word)
      await wait(10)
      let mode = await this.nvim.call('mode')
      if (mode !== 'i') {
        await document.patchChange()
        document.forceSync()
        return
      }
      let curcol = await this.nvim.call('col', ['.'])
      // not confirm
      if (curcol != col + item.word.length + 1) return
      await sources.doCompleteDone(item)
    } catch (e) {
      logger.error(`error on complete done`, e.message)
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
      this.startCompletion(option)
    }
  }

  private onInsertCharPre(character: string): void {
    this.lastInsert = {
      character,
      timestamp: Date.now(),
    }
  }

  private get latestInsert(): LastInsert | null {
    let { lastInsert } = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > 200) {
      return null
    }
    return lastInsert
  }

  private get latestInsertChar(): string {
    let { latestInsert } = this
    if (!latestInsert) return ''
    return latestInsert.character
  }

  private async shouldTrigger(character: string): Promise<boolean> {
    if (!character || character == ' ') return false
    let autoTrigger = this.preferences.get<string>('autoTrigger', 'always')
    if (autoTrigger == 'none') return false
    let doc = await workspace.document

    if (sources.shouldTrigger(character, doc.filetype)) return true
    if (autoTrigger !== 'always') return false
    if (doc.isWord(character)) {
      let minLength = this.preferences.get<number>('minTriggerInputLength', 1)
      let input = await this.nvim.call('coc#util#get_input') as string
      return input.length >= minLength
    }
    return false
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
