import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteConfig, CompleteOption, ISource, PopupChangeEvent, PumBounding, RecentScore, VimCompleteItem } from '../types'
import { disposeAll, wait } from '../util'
import { byteSlice, characterIndex } from '../util/string'
import workspace from '../workspace'
import Complete from './complete'
import Floating from './floating'
const logger = require('../util/logger')('completion')
const completeItemKeys = ['abbr', 'menu', 'info', 'kind', 'icase', 'dup', 'empty', 'user_data']

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  public config: CompleteConfig
  private document: Document
  private floating: Floating
  private currItem: VimCompleteItem
  // current input string
  private activated = false
  private input: string
  private lastInsert?: LastInsert
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  private recentScores: RecentScore = {}
  private resolveTokenSource: CancellationTokenSource
  private changedTick = 0
  private insertCharTs = 0
  private insertLeaveTs = 0
  // only used when no pum change event
  private isResolving = false

  public init(): void {
    this.config = this.getCompleteConfig()
    this.floating = new Floating()
    events.on('InsertCharPre', this.onInsertCharPre, this, this.disposables)
    events.on('InsertLeave', this.onInsertLeave, this, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedP', this.onTextChangedP, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    events.on('CompleteDone', this.onCompleteDone, this, this.disposables)
    events.on('MenuPopupChanged', this.onPumChange, this, this.disposables)
    events.on('CursorMovedI', debounce(async (bufnr, cursor) => {
      // try trigger completion
      let doc = workspace.getDocument(bufnr)
      if (this.isActivated || !doc || cursor[1] == 1 || !this.latestInsertChar) return
      let line = doc.getline(cursor[0] - 1)
      if (!line) return
      let pre = byteSlice(line, 0, cursor[1] - 1)
      if (sources.shouldTrigger(pre, doc.filetype)) {
        await this.triggerCompletion(doc, pre, false)
      }
    }, 50))
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('suggest')) {
        Object.assign(this.config, this.getCompleteConfig())
      }
    }, null, this.disposables)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public get option(): CompleteOption {
    if (!this.complete) return null
    return this.complete.option
  }

  private addRecent(word: string, bufnr: number): void {
    if (!word) return
    this.recentScores[`${bufnr}|${word}`] = Date.now()
  }

  private async getPreviousContent(document: Document): Promise<string> {
    let [, lnum, col] = await this.nvim.call('getcurpos')
    if (this.option && lnum != this.option.linenr) return null
    let line = document.getline(lnum - 1)
    return col == 1 ? '' : byteSlice(line, 0, col - 1)
  }

  public getResumeInput(pre: string): string {
    let { option, activated } = this
    if (!activated) return null
    if (!pre) return ''
    let input = byteSlice(pre, option.col)
    if (option.blacklist && option.blacklist.indexOf(input) !== -1) return null
    return input
  }

  private get bufnr(): number {
    let { option } = this
    return option ? option.bufnr : null
  }

  public get isActivated(): boolean {
    return this.activated
  }

  private getCompleteConfig(): CompleteConfig {
    let config = workspace.getConfiguration('coc.preferences')
    let suggest = workspace.getConfiguration('suggest')
    function getConfig<T>(key, defaultValue: T): T {
      return config.get<T>(key, suggest.get<T>(key, defaultValue))
    }
    let keepCompleteopt = getConfig<boolean>('keepCompleteopt', false)
    let autoTrigger = getConfig<string>('autoTrigger', 'always')
    if (keepCompleteopt) {
      let { completeOpt } = workspace
      if (!completeOpt.includes('noinsert') && !completeOpt.includes('noselect')) {
        autoTrigger = 'none'
      }
    }
    let acceptSuggestionOnCommitCharacter = workspace.env.pumevent && getConfig<boolean>('acceptSuggestionOnCommitCharacter', false)
    return {
      autoTrigger,
      keepCompleteopt,
      defaultSortMethod: getConfig<string>('defaultSortMethod', 'length'),
      removeDuplicateItems: getConfig<boolean>('removeDuplicateItems', false),
      disableMenuShortcut: getConfig<boolean>('disableMenuShortcut', false),
      acceptSuggestionOnCommitCharacter,
      disableKind: getConfig<boolean>('disableKind', false),
      disableMenu: getConfig<boolean>('disableMenu', false),
      previewIsKeyword: getConfig<string>('previewIsKeyword', '@,48-57,_192-255'),
      enablePreview: getConfig<boolean>('enablePreview', false),
      enablePreselect: getConfig<boolean>('enablePreselect', false),
      maxPreviewWidth: getConfig<number>('maxPreviewWidth', 50),
      labelMaxLength: getConfig<number>('labelMaxLength', 100),
      triggerAfterInsertEnter: getConfig<boolean>('triggerAfterInsertEnter', false),
      noselect: getConfig<boolean>('noselect', true),
      numberSelect: getConfig<boolean>('numberSelect', false),
      maxItemCount: getConfig<number>('maxCompleteItemCount', 50),
      timeout: getConfig<number>('timeout', 500),
      minTriggerInputLength: getConfig<number>('minTriggerInputLength', 1),
      snippetIndicator: getConfig<string>('snippetIndicator', '~'),
      fixInsertedWord: getConfig<boolean>('fixInsertedWord', true),
      localityBonus: getConfig<boolean>('localityBonus', true),
      highPrioritySourceLimit: getConfig<number>('highPrioritySourceLimit', null),
      lowPrioritySourceLimit: getConfig<number>('lowPrioritySourceLimit', null),
    }
  }

  public async startCompletion(option: CompleteOption): Promise<void> {
    workspace.bufnr = option.bufnr
    let document = workspace.getDocument(option.bufnr)
    if (!document) return
    // use fixed filetype
    option.filetype = document.filetype
    this.document = document
    try {
      await this._doComplete(option)
    } catch (e) {
      this.stop()
      workspace.showMessage(`Error happens on complete: ${e.message}`, 'error')
      logger.error(e.stack)
    }
  }

  private async resumeCompletion(pre: string, search: string | null, force = false): Promise<void> {
    let { document, complete, activated } = this
    if (!activated || !complete.results) return
    if (search == this.input && !force) return
    let last = search == null ? '' : search.slice(-1)
    if (last.length == 0 ||
      /\s/.test(last) ||
      sources.shouldTrigger(pre, document.filetype) ||
      search.length < complete.input.length) {
      this.stop()
      return
    }
    this.input = search
    let items: VimCompleteItem[]
    if (complete.isIncomplete && document.chars.isKeywordChar(last)) {
      await document.patchChange()
      document.forceSync()
      await wait(30)
      items = await complete.completeInComplete(search)
      // check search change
      let content = await this.getPreviousContent(document)
      let curr = this.getResumeInput(content)
      if (curr != search) return
    } else {
      items = complete.filterResults(search)
    }
    if (!this.isActivated) return
    if (!complete.isCompleting && (!items || items.length === 0)) {
      this.stop()
      return
    }
    await this.showCompletion(this.option.col, items)
  }

  public hasSelected(): boolean {
    if (workspace.env.pumevent) return this.currItem != null
    if (this.config.noselect === false) return true
    return this.isResolving
  }

  private async showCompletion(col: number, items: VimCompleteItem[]): Promise<void> {
    let { nvim, document, option } = this
    let { numberSelect, disableKind, labelMaxLength, disableMenuShortcut, disableMenu } = this.config
    let preselect = this.config.enablePreselect ? items.findIndex(o => o.preselect == true) : -1
    if (numberSelect && option.input.length && !/^\d/.test(option.input)) {
      items = items.map((item, i) => {
        let idx = i + 1
        if (i < 9) {
          return Object.assign({}, item, {
            abbr: item.abbr ? `${idx} ${item.abbr}` : `${idx} ${item.word}`
          })
        }
        return item
      })
      nvim.call('coc#_map', [], true)
    }
    this.changedTick = document.changedtick
    let validKeys = completeItemKeys.slice()
    if (disableKind) validKeys = validKeys.filter(s => s != 'kind')
    if (disableMenu) validKeys = validKeys.filter(s => s != 'menu')
    let vimItems = items.map(item => {
      let obj = { word: item.word, equal: 1 }
      for (let key of validKeys) {
        if (item.hasOwnProperty(key)) {
          if (disableMenuShortcut && key == 'menu') {
            obj[key] = item[key].replace(/\[\w+\]$/, '')
          } else if (key == 'abbr' && item[key].length > labelMaxLength) {
            obj[key] = item[key].slice(0, labelMaxLength)
          } else {
            obj[key] = item[key]
          }
        }
      }
      return obj
    })
    nvim.call('coc#_do_complete', [col, vimItems, preselect], true)
  }

  private async _doComplete(option: CompleteOption): Promise<void> {
    let { source } = option
    let { nvim, config, document } = this
    // current input
    this.input = option.input
    let arr: ISource[] = []
    if (source == null) {
      arr = sources.getCompleteSources(option)
    } else {
      let s = sources.getSource(source)
      if (s) arr.push(s)
    }
    if (!arr.length) return
    let complete = new Complete(option, document, this.recentScores, config, arr, nvim)
    this.start(complete)
    let items = await this.complete.doComplete()
    if (complete.isCanceled) return
    if (items.length == 0 && !complete.isCompleting) {
      this.stop()
      return
    }
    complete.onDidComplete(async () => {
      let content = await this.getPreviousContent(document)
      let search = this.getResumeInput(content)
      if (complete.isCanceled) return
      let hasSelected = this.hasSelected()
      if (hasSelected && this.completeOpt.indexOf('noselect') !== -1) return
      if (search == this.option.input) {
        let items = complete.filterResults(search, Math.floor(Date.now() / 1000))
        await this.showCompletion(option.col, items)
        return
      }
      await this.resumeCompletion(content, search, true)
    })
    if (items.length) {
      let content = await this.getPreviousContent(document)
      let search = this.getResumeInput(content)
      if (complete.isCanceled) return
      if (search == this.option.input) {
        await this.showCompletion(option.col, items)
        return
      }
      await this.resumeCompletion(content, search, true)
    }
  }

  private async onTextChangedP(): Promise<void> {
    let { option, document } = this
    if (!option) return
    await document.patchChange()
    let hasInsert = this.latestInsert != null
    this.lastInsert = null
    // avoid trigger filter on pumvisible
    if (document.changedtick == this.changedTick) return
    let line = document.getline(option.linenr - 1)
    let curr = line.match(/^\s*/)[0]
    let ind = option.line.match(/^\s*/)[0]
    // indent change
    if (ind.length != curr.length) {
      this.stop()
      return
    }
    if (!hasInsert) {
      // this could be wrong, but can't avoid.
      this.isResolving = true
      return
    }
    let pre = await this.getPreviousContent(document)
    if (!pre) return
    let search = this.getResumeInput(pre)
    if (sources.shouldTrigger(pre, document.filetype)) {
      await this.triggerCompletion(document, pre, false)
    } else {
      await this.resumeCompletion(pre, search)
    }
  }

  private async onTextChangedI(bufnr: number): Promise<void> {
    let { nvim, latestInsertChar } = this
    this.lastInsert = null
    let document = workspace.getDocument(workspace.bufnr)
    if (!document) return
    await document.patchChange()
    if (!this.isActivated) {
      if (!latestInsertChar) return
      let pre = await this.getPreviousContent(document)
      await this.triggerCompletion(document, pre)
      return
    }
    if (bufnr !== this.bufnr) return
    // check commit character
    if (this.config.acceptSuggestionOnCommitCharacter
      && this.currItem
      && latestInsertChar
      && !this.document.isWord(latestInsertChar)) {
      let resolvedItem = this.getCompleteItem(this.currItem)
      if (sources.shouldCommit(resolvedItem, latestInsertChar)) {
        let { linenr, col, line, colnr } = this.option
        this.stop()
        let { word } = resolvedItem
        let newLine = `${line.slice(0, col)}${word}${latestInsertChar}${line.slice(colnr - 1)}`
        await nvim.call('coc#util#setline', [linenr, newLine])
        let curcol = col + word.length + 2
        await nvim.call('cursor', [linenr, curcol])
        return
      }
    }
    let content = await this.getPreviousContent(document)
    if (content == null) {
      // cursor line changed
      this.stop()
      return
    }
    // check trigger character
    if (sources.shouldTrigger(content, document.filetype)) {
      await this.triggerCompletion(document, content, false)
      return
    }
    if (!this.isActivated || this.complete.isEmpty) return
    let search = content.slice(characterIndex(content, this.option.col))
    return await this.resumeCompletion(content, search)
  }

  private async triggerCompletion(document: Document, pre: string, checkTrigger = true): Promise<void> {
    // check trigger
    if (checkTrigger) {
      let shouldTrigger = await this.shouldTrigger(document, pre)
      if (!shouldTrigger) return
    }
    let option: CompleteOption = await this.nvim.call('coc#util#get_complete_option')
    if (!option) return
    this.fixCompleteOption(option)
    option.triggerCharacter = pre.slice(-1)
    logger.debug('trigger completion with', option)
    await this.startCompletion(option)
  }

  private fixCompleteOption(opt: CompleteOption): void {
    if (workspace.isVim) {
      for (let key of ['word', 'input', 'line', 'filetype']) {
        if (opt[key] == null) {
          opt[key] = ''
        }
      }
    }
  }

  private async onCompleteDone(item: VimCompleteItem): Promise<void> {
    let { document } = this
    if (!this.isActivated || !document || !item.hasOwnProperty('word')) return
    let visible = await this.nvim.call('pumvisible')
    if (visible) return
    let opt = Object.assign({}, this.option)
    let resolvedItem = this.getCompleteItem(item)
    this.stop()
    if (!resolvedItem) return
    let timestamp = this.insertCharTs
    let insertLeaveTs = this.insertLeaveTs
    try {
      await sources.doCompleteResolve(resolvedItem, (new CancellationTokenSource()).token)
      this.addRecent(resolvedItem.word, document.bufnr)
      await wait(50)
      if (this.insertCharTs != timestamp
        || this.insertLeaveTs != insertLeaveTs) return
      await document.patchChange()
      let content = await this.getPreviousContent(document)
      if (!content.endsWith(resolvedItem.word)) return
      await sources.doCompleteDone(resolvedItem, opt)
      document.forceSync()
    } catch (e) {
      // tslint:disable-next-line:no-console
      console.error(e.stack)
      logger.error(`error on complete done`, e.stack)
    }
  }

  private async onInsertLeave(bufnr: number): Promise<void> {
    this.insertLeaveTs = Date.now()
    if (this.isActivated) {
      let doc = workspace.getDocument(bufnr)
      if (doc) doc.forceSync()
      this.stop()
    }
  }

  private async onInsertEnter(bufnr: number): Promise<void> {
    if (!this.config.triggerAfterInsertEnter) return
    let document = workspace.getDocument(bufnr)
    await document.patchChange()
    if (!document) return
    let cursor = await this.nvim.call('coc#util#cursor')
    let line = document.getline(cursor[0])
    let pre = byteSlice(line, 0, cursor[1])
    if (!pre) return
    await this.triggerCompletion(document, pre, false)
  }

  private async onInsertCharPre(character: string): Promise<void> {
    this.lastInsert = {
      character,
      timestamp: Date.now(),
    }
    this.insertCharTs = this.lastInsert.timestamp
  }

  private get latestInsert(): LastInsert | null {
    let { lastInsert } = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > 500) {
      return null
    }
    return lastInsert
  }

  private get latestInsertChar(): string {
    let { latestInsert } = this
    if (!latestInsert) return ''
    return latestInsert.character
  }

  public async shouldTrigger(document: Document, pre: string): Promise<boolean> {
    if (pre.length == 0 || /\s/.test(pre[pre.length - 1])) return false
    let autoTrigger = this.config.autoTrigger
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, document.filetype)) return true
    if (autoTrigger !== 'always') return false
    let last = pre.slice(-1)
    if (last && (document.isWord(pre.slice(-1)) || last.codePointAt(0) > 255)) {
      let minLength = this.config.minTriggerInputLength
      if (minLength == 1) return true
      let input = this.getInput(document, pre)
      return input.length >= minLength
    }
    return false
  }

  public async onPumChange(ev: PopupChangeEvent): Promise<void> {
    if (!this.activated) return
    if (this.document && this.document.uri.endsWith('%5BCommand%20Line%5D')) return
    this.cancel()
    let { completed_item, col, row, height, width, scrollbar } = ev
    let bounding: PumBounding = { col, row, height, width, scrollbar }
    this.currItem = completed_item.hasOwnProperty('word') ? completed_item : null
    // it's pum change by vim, ignore it
    if (this.lastInsert) return
    let resolvedItem = this.getCompleteItem(completed_item)
    if (!resolvedItem) {
      this.floating.close()
      return
    }
    let source = this.resolveTokenSource = new CancellationTokenSource()
    let { token } = source
    await sources.doCompleteResolve(resolvedItem, token)
    if (token.isCancellationRequested) return
    let docs = resolvedItem.documentation
    if (!docs && resolvedItem.info) {
      let { info } = resolvedItem
      let isText = /^[\w-\s.,\t]+$/.test(info)
      docs = [{ filetype: isText ? 'txt' : this.document.filetype, content: info }]
    }
    if (!docs || docs.length == 0) {
      this.floating.close()
    } else {
      if (token.isCancellationRequested) return
      await this.floating.show(docs, bounding, token)
    }
    this.resolveTokenSource = null
  }

  public start(complete: Complete): void {
    let { activated } = this
    this.activated = true
    this.isResolving = false
    if (activated) {
      this.complete.dispose()
    }
    this.complete = complete
    if (!this.config.keepCompleteopt) {
      this.nvim.command(`noa set completeopt=${this.completeOpt}`, true)
    }
    this.document.forceSync(true)
    this.document.paused = true
  }

  private cancel(): void {
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = null
    }
  }

  public stop(): void {
    let { nvim } = this
    if (!this.activated) return
    this.cancel()
    this.currItem = null
    this.activated = false
    this.document.paused = false
    this.document.fireContentChanges()
    if (this.complete) {
      this.complete.dispose()
      this.complete = null
    }
    nvim.pauseNotification()
    if (this.config.numberSelect) {
      nvim.call('coc#_unmap', [], true)
    }
    if (!this.config.keepCompleteopt) {
      this.nvim.command(`noa set completeopt=${workspace.completeOpt}`, true)
    }
    nvim.command(`let g:coc#_context['candidates'] = []`, true)
    nvim.call('coc#_hide', [], true)
    nvim.resumeNotification(false, true).catch(_e => {
      // noop
    })
  }

  private getInput(document: Document, pre: string): string {
    let input = ''
    for (let i = pre.length - 1; i >= 0; i--) {
      let ch = i == 0 ? null : pre[i - 1]
      if (!ch || !document.isWord(ch)) {
        input = pre.slice(i, pre.length)
        break
      }
    }
    return input
  }

  private get completeOpt(): string {
    let { noselect, enablePreview } = this.config
    let preview = enablePreview && !workspace.env.pumevent ? ',preview' : ''
    if (noselect) return `noselect,menuone${preview}`
    return `noinsert,menuone${preview}`
  }

  private getCompleteItem(item: VimCompleteItem): VimCompleteItem | null {
    if (!this.isActivated) return null
    return this.complete.resolveCompletionItem(item)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
