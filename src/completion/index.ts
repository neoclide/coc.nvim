import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteConfig, CompleteOption, RecentScore, VimCompleteItem } from '../types'
import { disposeAll, wait } from '../util'
import { byteLength, byteSlice, isWord } from '../util/string'
import workspace from '../workspace'
import Complete from './complete'
const logger = require('../util/logger')('completion')

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  // current input string
  private activted = false
  private completeId = 0
  private input: string
  private config: CompleteConfig
  private lastInsert?: LastInsert
  private insertMode = false
  private nvim: Neovim
  private disposables: Disposable[] = []
  private _completeItems: VimCompleteItem[] = []
  private complete: Complete | null = null
  private recentScores: RecentScore = {}
  private triggerCharacters: Set<string> = new Set()
  private changedTick = 0
  private currIndex = 0
  private insertCharTs = 0
  private lastMoveTs = 0

  public init(nvim: Neovim): void {
    this.nvim = nvim
    this.config = this.getCompleteConfig()
    this.disposables.push(events.on('CursorMoved', this.onCursorMove, this))
    this.disposables.push(events.on('CursorMovedI', this.onCursorMove, this))
    this.disposables.push(events.on('InsertCharPre', this.onInsertCharPre, this))
    this.disposables.push(events.on('InsertLeave', this.onInsertLeave, this))
    this.disposables.push(events.on('InsertEnter', this.onInsertEnter, this))
    this.disposables.push(events.on('TextChangedP', this.onTextChangedP, this))
    this.disposables.push(events.on('TextChangedI', this.onTextChangedI, this))
    this.disposables.push(events.on('CompleteDone', this.onCompleteDone, this))
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('coc.preferences')) {
        Object.assign(this.config, this.getCompleteConfig())
      }
    }, null, this.disposables)
    nvim.call('mode').then(m => {
      this.insertMode = m.startsWith('i')
    })
  }

  private get document(): Document {
    return workspace.getDocument(workspace.bufnr)
  }

  public get option(): CompleteOption {
    if (!this.complete) return null
    return this.complete.option
  }

  public get resolving(): boolean {
    return this.currIndex !== 0
  }

  public getPreference<T extends keyof CompleteConfig>(key: T): any {
    return this.config[key]
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

  private async onCursorMove(): Promise<void> {
    this.lastMoveTs = Date.now()
  }

  private async getPreviousCharacter(): Promise<string> {
    let { document } = this
    if (!document) return ''
    let [, lnum, col] = await this.nvim.call('getcurpos')
    let line = document.getline(lnum - 1)
    return col < 2 ? '' : byteSlice(line, col - 2, col - 1)
  }

  public async getResumeInput(): Promise<string> {
    let { option, document } = this
    if (!document || !option) return null
    let [, lnum, col] = await this.nvim.call('getcurpos')
    if (lnum != option.linenr || col < option.col + 1) {
      this.stop()
      return null
    }
    let line = document.getline(lnum - 1)
    return byteSlice(line, option.col, col - 1)
  }

  private get bufnr(): number {
    let { option } = this
    return option ? option.bufnr : null
  }

  public get isActivted(): boolean {
    return this.activted
  }

  private getCompleteConfig(): CompleteConfig {
    let config = workspace.getConfiguration('coc.preferences')
    let autoTrigger = config.get<string>('autoTrigger', 'always')
    return {
      autoTrigger,
      triggerAfterInsertEnter: config.get<boolean>('triggerAfterInsertEnter', false),
      noselect: config.get<boolean>('noselect', true),
      noinsert: autoTrigger === 'none' ? config.get<boolean>('noinsert', true) : true,
      numberSelect: config.get<boolean>('numberSelect', false),
      acceptSuggestionOnCommitCharacter: config.get<boolean>('acceptSuggestionOnCommitCharacter', false),
      maxItemCount: config.get<number>('maxCompleteItemCount', 50),
      timeout: config.get<number>('timeout', 500),
      minTriggerInputLength: config.get<number>('minTriggerInputLength', 1),
      snippetIndicator: config.get<string>('snippetIndicator', '~'),
      fixInsertedWord: config.get<boolean>('fixInsertedWord', true),
      localityBonus: config.get<boolean>('localityBonus', true),
      invalidInsertCharacters: config.get<string[]>('invalidInsertCharacters', ["<", "(", ":", " "]),
    }
  }

  public async startCompletion(option: CompleteOption): Promise<void> {
    workspace.bufnr = option.bufnr
    if (!this.document) return
    this.stop()
    // use coverted filetype
    option.filetype = this.document.filetype
    // current input
    this.input = option.input
    this.triggerCharacters = sources.getTriggerCharacters(option.filetype)
    try {
      await this._doComplete(option)
    } catch (e) {
      this.stop()
      workspace.showMessage(`Error happens on complete: ${e.message}`, 'error')
      logger.error(e.stack)
    }
  }

  private async resumeCompletion(resumeInput: string, _isChangedP = false): Promise<void> {
    let { document, complete } = this
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
    if (!this.insertMode || !items || items.length === 0) {
      this._completeItems = []
      this.stop()
      return
    }
    await this.showCompletion(this.option.col, items)
  }

  private appendNumber(items: VimCompleteItem[]): void {
    if (!this.config.numberSelect) return
    for (let i = 1; i <= 10; i++) {
      let item = items[i - 1]
      if (!item) break
      let idx = i == 10 ? 0 : i
      item.abbr = item.abbr ? `${idx} ${item.abbr}` : `${idx} ${item.word}`
    }
  }

  private async onPumVisible(): Promise<void> {
    let first = this._completeItems[0]
    let { noselect, noinsert } = this.config
    if (!noselect || !noinsert) await sources.doCompleteResolve(first)
  }

  public hasSelected(): boolean {
    return this.currIndex != 0
  }

  private async showCompletion(col: number, items: VimCompleteItem[]): Promise<void> {
    let { nvim, document } = this
    this.appendNumber(items)
    this.changedTick = document.changedtick
    if (this.config.numberSelect) {
      nvim.call('coc#_map', [], true)
    }
    nvim.call('coc#_do_complete', [col, items], true)
    this._completeItems = items
    await this.onPumVisible()
  }

  private async _doComplete(option: CompleteOption): Promise<void> {
    let { linenr, line } = option
    let { nvim, config, document } = this
    this.completeId = this.completeId + 1
    let completeId = this.completeId
    let arr = sources.getCompleteSources(option, this.triggerCharacters.has(option.triggerCharacter))
    this.complete = new Complete(option, document, this.recentScores, config, nvim)
    this.start()
    let items = await this.complete.doComplete(arr)
    if (items.length == 0 || completeId != this.completeId || !this.isActivted) {
      this.stop()
      return
    }
    // changedtick could change without content change
    if (document.getline(linenr - 1) == line) {
      await this.showCompletion(option.col, items)
      return
    }
    let search = await this.getResumeInput()
    if (search == null || completeId != this.completeId) return
    await this.resumeCompletion(search)
  }

  private async onTextChangedP(): Promise<void> {
    let { option, document } = this
    if (document) await document.patchChange()
    // filtered by remove character
    if (!document || !option || !this.isActivted) return
    // neovim would trigger TextChangedP after fix of word
    // avoid trigger filter on pumvisible
    if (document.changedtick == this.changedTick) return
    let { latestInsert } = this
    this.lastInsert = null
    let col = await this.nvim.call('col', ['.'])
    if (col < option.colnr && !latestInsert) {
      this.stop()
      return null
    }
    let line = this.document.getline(option.linenr - 1)
    let search = byteSlice(line, option.col, col - 1)
    if (latestInsert) {
      let ind = option.line.match(/^\s*/)[0].length
      let curr = line.match(/^\s*/)[0].length
      if (ind != curr) {
        // indented by vim
        let newCol = option.col + curr - ind
        Object.assign(option, { col: newCol })
        search = byteSlice(line, newCol, col - 1)
      }
      await this.resumeCompletion(search, true)
      return
    }
    let item = this.getCompleteItem(search)
    if (item) {
      if (item.isSnippet) {
        let { word } = item
        let text = this.getValidWord(word)
        if (word != text) {
          let before = byteSlice(line, 0, option.col)
          let after = byteSlice(line, option.col + byteLength(word))
          line = `${before}${text}${after}`
          await this.nvim.call('coc#util#setline', [option.linenr, line])
          if (workspace.isNvim) this.changedTick = document.changedtick
          await this.nvim.call('cursor', [option.linenr, col - byteLength(word.slice(text.length))])
          if (workspace.isVim) await document.patchChange()
        }
      }
      await sources.doCompleteResolve(item)
    }
  }

  private async onTextChangedI(bufnr: number): Promise<void> {
    this.insertMode = true
    let { nvim, input, latestInsertChar } = this
    let document = workspace.getDocument(workspace.bufnr)
    this.lastInsert = null
    if (latestInsertChar && document) await document.patchChange()
    if (this.isActivted) {
      if (bufnr !== this.bufnr) return
      // check commit character
      if (this.config.acceptSuggestionOnCommitCharacter
        && this._completeItems.length
        && latestInsertChar
        && !isWord(latestInsertChar)
        && !this.resolving) {
        let item = this._completeItems[0]
        if (sources.shouldCommit(item, latestInsertChar)) {
          let { linenr, col, line, colnr } = this.option
          this.stop()
          let { word } = item
          let newLine = `${line.slice(0, col)}${word}${latestInsertChar}${line.slice(colnr - 1)}`
          await nvim.call('coc#util#setline', [linenr, newLine])
          let curcol = col + word.length + 2
          await nvim.call('cursor', [linenr, curcol])
        }
      }
      let search = await this.getResumeInput()
      let character = search ? search[search.length - 1] : ''
      // check trigger character.
      if (character && this.triggerCharacters.has(character)) {
        this.stop()
        await this.triggerCompletion(character)
        return
      }
      if (search == input || !this.isActivted) return
      if (search == null
        || search.endsWith(' ')
        || search.length < this.option.input.length) {
        this.stop()
        return
      }
      return await this.resumeCompletion(search)
    }
    let character = await this.getPreviousCharacter()
    if (!character) return
    if (latestInsertChar) {
      await this.triggerCompletion(character)
    } else if (sources.shouldTrigger(character, document.filetype)) {
      let now = Date.now()
      let changedtick = document.changedtick
      await wait(100)
      if (this.isActivted || document.changedtick != changedtick || this.lastMoveTs >= now) return
      await this.triggerCompletion(character)
    }
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
    let { document, nvim } = this
    if (!this.isActivted || !document || !item.word) return
    let opt = Object.assign({}, this.option)
    item = this._completeItems.find(o => o.word == item.word && o.user_data == item.user_data)
    this.stop()
    if (!item) return
    let timestamp = this.insertCharTs
    await document.patchChangedTick()
    let { changedtick } = document
    try {
      await sources.doCompleteResolve(item)
      this.addRecent(item.word, document.bufnr)
      await wait(50)
      let mode = await nvim.call('mode')
      if (mode != 'i' || this.insertCharTs != timestamp) return
      await document.patchChange()
      if (changedtick != document.changedtick) return
      await sources.doCompleteDone(item, opt)
      document.forceSync()
    } catch (e) {
      // tslint:disable-next-line:no-console
      console.error(e.stack)
      logger.error(`error on complete done`, e.stack)
    }
  }

  private async onInsertLeave(): Promise<void> {
    this.insertMode = false
    this.stop()
  }

  private async onInsertEnter(): Promise<void> {
    this.insertMode = true
    if (!this.config.triggerAfterInsertEnter) return
    let option = await this.nvim.call('coc#util#get_complete_option')
    if (option.input.length >= this.config.minTriggerInputLength) {
      await this.startCompletion(option)
    }
  }

  private async onInsertCharPre(character: string): Promise<void> {
    // hack to make neovim not flicking
    if (this.isActivted &&
      workspace.isNvim &&
      !global.hasOwnProperty('__TEST__') &&
      !this.triggerCharacters.has(character) &&
      isWord(character)) {
      this.nvim.call('coc#_reload', [], true)
    }
    this.lastInsert = {
      character,
      timestamp: Date.now(),
    }
    this.insertCharTs = this.lastInsert.timestamp
  }

  private get latestInsert(): LastInsert | null {
    let { lastInsert } = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > 100) {
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
    let autoTrigger = this.config.autoTrigger
    if (autoTrigger == 'none') return false
    let { document } = this
    if (!document) return false
    if (sources.shouldTrigger(character, document.filetype)) return true
    if (autoTrigger !== 'always') return false
    if (document.isWord(character)) {
      let minLength = this.config.minTriggerInputLength
      if (minLength == 1) return true
      let input = await this.nvim.call('coc#util#get_input') as string
      return input.length >= minLength
    }
    return false
  }

  public get completeItems(): VimCompleteItem[] {
    return this._completeItems
  }

  private getValidWord(text: string): string {
    let invalidChars = this.config.invalidInsertCharacters
    for (let i = 0; i < text.length; i++) {
      let c = text[i]
      if (invalidChars.indexOf(c) !== -1) {
        return text.slice(0, i)
      }
    }
    return text
  }

  public start(): void {
    let { nvim, activted } = this
    if (activted) return
    this.activted = true
    nvim.command(`noa set completeopt=${this.completeOpt}`, true)
    this.currIndex = (this.config.noselect && this.config.noinsert) ? 0 : 1
    this.changedTick = this.document.changedtick
    this._completeItems = []
    this.document.paused = true
  }

  public stop(): void {
    let { nvim, activted } = this
    if (!activted) return
    this.activted = false
    this.document.paused = false
    if (this.complete) {
      this.complete.cancel()
      this.complete = null
    }
    if (this.config.numberSelect) {
      nvim.call('coc#_unmap', [], true)
    }
    nvim.call('coc#_hide', [], true)
    nvim.command(`noa set completeopt=${workspace.completeOpt}`, true)
  }

  private get completeOpt(): string {
    let { noselect, noinsert } = this.config
    let preview = workspace.completeOpt.indexOf('preview') !== -1
    return `${noselect ? 'noselect,' : ''}${noinsert ? 'noinsert' : ''},menuone${preview ? ',preview' : ''}`
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
