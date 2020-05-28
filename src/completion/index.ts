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
import throttle from '../util/throttle'
import { equals } from '../util/object'
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

  public init(): void {
    this.config = this.getCompleteConfig()
    this.floating = new Floating()
    events.on('InsertCharPre', this.onInsertCharPre, this, this.disposables)
    events.on('InsertLeave', this.onInsertLeave, this, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedP', this.onTextChangedP, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    let fn = throttle(this.onPumChange.bind(this), workspace.isVim ? 200 : 100)
    events.on('CompleteDone', async item => {
      this.currItem = null
      this.cancel()
      this.floating.close()
      await this.onCompleteDone(item)
    }, this, this.disposables)
    events.on('MenuPopupChanged', ev => {
      if (!this.activated || this.isCommandLine) return
      let { completed_item } = ev
      let item = completed_item.hasOwnProperty('word') ? completed_item : null
      if (equals(item, this.currItem)) return
      this.cancel()
      this.currItem = item
      fn(ev)
    }, this, this.disposables)
    // check if we need trigger after complete done
    events.on('CursorMovedI', debounce(async bufnr => {
      if (this.complete) return
      // try trigger completion
      let doc = workspace.getDocument(bufnr)
      await this.triggerSourceCompletion(doc)
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

  private get isCommandLine(): boolean {
    return this.document && this.document.uri.endsWith('%5BCommand%20Line%5D')
  }

  private addRecent(word: string, bufnr: number): void {
    if (!word) return
    this.recentScores[`${bufnr}|${word}`] = Date.now()
  }

  private async getPreviousContent(): Promise<string> {
    return await this.nvim.eval(`strpart(getline('.'), 0, col('.') - 1)`) as string
  }

  public getResumeInput(pre: string): string {
    let { option, activated } = this
    if (!activated) return null
    if (!pre) return ''
    let input = byteSlice(pre, option.col)
    if (option.blacklist && option.blacklist.includes(input)) return null
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
      maxPreviewWidth: getConfig<number>('maxPreviewWidth', 80),
      labelMaxLength: getConfig<number>('labelMaxLength', 200),
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
      asciiCharactersOnly: getConfig<boolean>('asciiCharactersOnly', false)
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
    if (!search.length ||
      search.endsWith(' ') ||
      sources.shouldTrigger(pre, document.filetype) ||
      search.length < complete.input.length) {
      this.stop()
      return
    }
    this.input = search
    let items: VimCompleteItem[]
    if (complete.isIncomplete) {
      await document.patchChange()
      items = await complete.completeInComplete(search)
      // check search change
      let content = await this.getPreviousContent()
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
    if (!this.config.noselect) return true
    return false
  }

  private async showCompletion(col: number, items: VimCompleteItem[]): Promise<void> {
    let { nvim, document, option } = this
    let { numberSelect, disableKind, labelMaxLength, disableMenuShortcut, disableMenu } = this.config
    let preselect = this.config.enablePreselect ? items.findIndex(o => o.preselect) : -1
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
    await document.patchChange()
    let complete = new Complete(option, document, this.recentScores, config, arr, nvim)
    this.start(complete)
    let items = await this.complete.doComplete()
    if (complete.isCanceled) return
    if (items.length == 0 && !complete.isCompleting) {
      this.stop()
      return
    }
    complete.onDidComplete(async () => {
      let content = await this.getPreviousContent()
      if (!content || complete.isCanceled) return
      let search = this.getResumeInput(content)
      let hasSelected = this.hasSelected()
      if (hasSelected && this.completeOpt.includes('noselect')) return
      let { input } = this.option
      if (search.startsWith(input)) {
        let items = complete.filterResults(search, Math.floor(Date.now() / 1000))
        await this.showCompletion(option.col, items)
      }
    })
    if (items.length) {
      let content = await this.getPreviousContent()
      let search = this.getResumeInput(content)
      if (complete.isCanceled) return
      if (search == this.option.input) {
        await this.showCompletion(option.col, items)
      } else {
        await this.resumeCompletion(content, search, true)
      }
    }
  }

  private async onTextChangedP(): Promise<void> {
    let { option, document } = this
    if (!option) return
    await document.patchChange(true)
    let hasInsert = this.latestInsert != null
    this.lastInsert = null
    // avoid trigger filter on pumvisible
    if (document.changedtick == this.changedTick || !this.activated) return
    let line = document.getline(option.linenr - 1)
    let curr = line.match(/^\s*/)[0]
    let ind = option.line.match(/^\s*/)[0]
    // indent change
    if (ind.length != curr.length) {
      this.stop()
      return
    }
    if (!hasInsert) return
    let pre = await this.getPreviousContent()
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
    if (!document || !document.attached) return
    // try trigger on character type
    if (!this.activated && latestInsertChar) {
      let pre = await this.getPreviousContent()
      await this.triggerCompletion(document, pre)
      return
    }
    // not completing
    if (!this.activated || this.bufnr != bufnr) return
    // check commit character
    if (this.currItem
      && this.config.acceptSuggestionOnCommitCharacter
      && latestInsertChar
      && !document.isWord(latestInsertChar)) {
      let resolvedItem = this.getCompleteItem(this.currItem)
      if (sources.shouldCommit(resolvedItem, latestInsertChar)) {
        let { linenr, col, line, colnr } = this.option
        this.stop()
        let { word } = resolvedItem
        let newLine = `${line.slice(0, col)}${word}${latestInsertChar}${line.slice(colnr - 1)}`
        await nvim.call('coc#util#setline', [linenr, newLine])
        let curcol = col + word.length + 2
        await nvim.call('cursor', [linenr, curcol])
        await document.patchChange()
        return
      }
    }
    let [lnum, content] = await this.nvim.eval(`[line('.'),strpart(getline('.'), 0, col('.') - 1)]`) as [number, string]
    if (!this.activated) return
    let { col, linenr } = this.option
    if (!content || lnum != linenr) {
      this.stop()
      return
    }
    // prefer trigger completion
    if (sources.shouldTrigger(content, document.filetype)) {
      await this.triggerCompletion(document, content, false)
    } else {
      let search = content.slice(characterIndex(content, col))
      await this.resumeCompletion(content, search)
    }
  }

  private async triggerCompletion(document: Document, pre: string, checkTrigger = true): Promise<void> {
    // check trigger
    if (checkTrigger) {
      let shouldTrigger = await this.shouldTrigger(document, pre)
      if (!shouldTrigger) return
    }
    let option: CompleteOption = await this.nvim.call('coc#util#get_complete_option')
    if (!option) return
    option.triggerCharacter = pre.slice(-1)
    logger.debug('trigger completion with', option)
    await this.startCompletion(option)
  }

  private async triggerSourceCompletion(doc: Document): Promise<boolean> {
    if (!doc || !doc.attached) return false
    let [bufnr, pre] = await this.nvim.eval(`[bufnr('%'),strpart(getline('.'), 0, col('.') - 1)]`) as [number, string]
    if (doc.bufnr != bufnr || this.complete) return false
    if (sources.shouldTrigger(pre, doc.filetype)) {
      this.triggerCompletion(doc, pre, false).catch(e => {
        logger.error(e)
      })
      return true
    }
    return false
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
      let content = await this.getPreviousContent()
      if (!content.endsWith(resolvedItem.word)) return
      await sources.doCompleteDone(resolvedItem, opt)
      await document.patchChange()
    } catch (e) {
      logger.error(`error on complete done`, e.stack)
    }
  }

  private async onInsertLeave(): Promise<void> {
    this.insertLeaveTs = Date.now()
    this.stop()
  }

  private async onInsertEnter(bufnr: number): Promise<void> {
    if (!this.config.triggerAfterInsertEnter || this.config.autoTrigger !== 'always') return
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return
    let pre = await this.getPreviousContent()
    if (!pre) return
    await this.triggerCompletion(doc, pre)
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
    if (!document.attached) return false
    if (pre.length == 0 || /\s/.test(pre[pre.length - 1])) return false
    let autoTrigger = this.config.autoTrigger
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, document.filetype)) return true
    if (autoTrigger !== 'always' || this.isActivated) return false
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
    let { completed_item, col, row, height, width, scrollbar } = ev
    let bounding: PumBounding = { col, row, height, width, scrollbar }
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
    if (!this.isActivated) return
    if (!docs || docs.length == 0) {
      this.floating.close()
    } else {
      await this.floating.show(docs, bounding, token)
      if (!this.isActivated) {
        this.floating.close()
      }
    }
  }

  public start(complete: Complete): void {
    let { activated } = this
    this.activated = true
    if (activated) {
      this.complete.dispose()
    }
    this.complete = complete
    if (!this.config.keepCompleteopt) {
      this.nvim.command(`noa set completeopt=${this.completeOpt}`, true)
    }
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
    this.currItem = null
    this.activated = false
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
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
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
    if (!this.isActivated || item == null) return null
    return this.complete.resolveCompletionItem(item)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
