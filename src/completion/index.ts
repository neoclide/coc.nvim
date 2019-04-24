import { Buffer, Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { Chars } from '../model/chars'
import Document from '../model/document'
import sources from '../sources'
import { CompleteConfig, CompleteOption, ISource, PopupChangeEvent, PumBounding, RecentScore, VimCompleteItem } from '../types'
import { disposeAll, wait } from '../util'
import { byteSlice, characterIndex } from '../util/string'
import workspace from '../workspace'
import Complete from './complete'
import FloatingWindow from './floating'
import debounce from 'debounce'
const logger = require('../util/logger')('completion')
const completeItemKeys = ['abbr', 'menu', 'info', 'kind', 'icase', 'dup', 'empty', 'user_data']

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  public config: CompleteConfig
  private document: Document
  private floating: FloatingWindow
  private currItem: VimCompleteItem
  // current input string
  private activted = false
  private input: string
  private lastInsert?: LastInsert
  private nvim: Neovim
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  private recentScores: RecentScore = {}
  private resolveTokenSource: CancellationTokenSource
  private floatTokenSource: CancellationTokenSource
  private changedTick = 0
  private insertCharTs = 0
  private insertLeaveTs = 0
  // only used when no pum change event
  private isResolving = false
  private previewBuffer: Buffer

  public init(nvim: Neovim): void {
    this.nvim = nvim
    this.config = this.getCompleteConfig()
    events.on('InsertCharPre', this.onInsertCharPre, this, this.disposables)
    events.on('InsertLeave', this.onInsertLeave, this, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedP', this.onTextChangedP, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    events.on('CompleteDone', this.onCompleteDone, this, this.disposables)
    events.on('MenuPopupChanged', this.onPumChange, this, this.disposables)
    events.on('BufUnload', async bufnr => {
      if (this.previewBuffer && bufnr == this.previewBuffer.id) {
        this.previewBuffer = null
      }
    }, null, this.disposables)
    events.on('CursorMovedI', debounce(async (bufnr, cursor) => {
      // try trigger completion
      let doc = workspace.getDocument(bufnr)
      if (this.isActivted || !doc || cursor[1] == 1) return
      let line = doc.getline(cursor[0] - 1)
      if (!line) return
      let { latestInsertChar } = this
      let pre = byteSlice(line, 0, cursor[1] - 1)
      if (!latestInsertChar || !pre.endsWith(latestInsertChar)) return
      if (sources.shouldTrigger(pre, doc.filetype)) {
        await this.triggerCompletion(doc, pre, false)
      }
    }, 20))
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('suggest')) {
        Object.assign(this.config, this.getCompleteConfig())
      }
    }, null, this.disposables)
    if (workspace.env.pumevent) {
      events.on('CompleteDone', () => {
        if (this.floatTokenSource) {
          this.floatTokenSource.cancel()
          this.floatTokenSource = null
        }
      }, null, this.disposables)
    }
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
    let { option, activted } = this
    if (!activted || !pre) return null
    let input = byteSlice(pre, option.col)
    if (option.blacklist && option.blacklist.indexOf(input) !== -1) return null
    return input
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
      acceptSuggestionOnCommitCharacter,
      disableKind: getConfig<boolean>('disableKind', false),
      disableMenu: getConfig<boolean>('disableMenu', false),
      previewIsKeyword: getConfig<string>('previewIsKeyword', '@,48-57,_192-255'),
      enablePreview: getConfig<boolean>('enablePreview', false),
      maxPreviewWidth: getConfig<number>('maxPreviewWidth', 50),
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
    let { document, complete, activted } = this
    if (!activted || !complete.results) return
    if (search == this.input && !force) return
    let last = search == null ? '' : search.slice(-1)
    if (last.length == 0 ||
      /\s/.test(last) ||
      sources.shouldTrigger(pre, document.filetype) ||
      search.length < complete.input.length) {
      this.stop()
      return
    }
    let { changedtick } = document
    this.input = search
    let items: VimCompleteItem[]
    if (complete.isIncomplete && document.chars.isKeywordChar(last)) {
      await document.patchChange()
      document.forceSync()
      await wait(30)
      if (document.changedtick != changedtick) return
      items = await complete.completeInComplete(search)
      if (document.changedtick != changedtick) return
    } else {
      items = complete.filterResults(search)
    }
    if (!this.isActivted) return
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
    let { nvim, document } = this
    let { numberSelect, disableKind, disableMenu } = this.config
    if (numberSelect) {
      items = items.map((item, i) => {
        let idx = i + 1
        if (i < 9) {
          return Object.assign({}, item, {
            abbr: item.abbr ? `${idx} ${item.abbr}` : `${idx} ${item.word}`
          })
        }
        return item
      })
    }
    this.changedTick = document.changedtick
    if (this.config.numberSelect) {
      nvim.call('coc#_map', [], true)
    }
    let validKeys = completeItemKeys.slice()
    if (disableKind) validKeys = validKeys.filter(s => s != 'kind')
    if (disableMenu) validKeys = validKeys.filter(s => s != 'menu')
    let vimItems = items.map(item => {
      let obj = { word: item.word, equal: 1 }
      for (let key of validKeys) {
        if (item.hasOwnProperty(key)) {
          obj[key] = item[key]
        }
      }
      return obj
    })
    nvim.call('coc#_do_complete', [col, vimItems], true)
  }

  private async _doComplete(option: CompleteOption): Promise<void> {
    let { line, colnr, filetype, source } = option
    let { nvim, config, document } = this
    // current input
    let input = this.input = option.input
    let pre = byteSlice(line, 0, colnr - 1)
    let isTriggered = source == null && pre && !document.isWord(pre[pre.length - 1]) && sources.shouldTrigger(pre, filetype)
    let arr: ISource[] = []
    if (source == null) {
      arr = sources.getCompleteSources(option, isTriggered)
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
      if (search == input) {
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
      if (search == input) {
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
    let col = await this.nvim.call('col', '.')
    let search = byteSlice(line, option.col, col - 1)
    let pre = byteSlice(line, 0, col - 1)
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
    if (!this.isActivted) {
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
    if (!this.isActivted || this.complete.isEmpty) return
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
    option.triggerCharacter = pre.slice(-1)
    logger.debug('trigger completion with', option)
    await this.startCompletion(option)
  }

  private async onCompleteDone(item: VimCompleteItem): Promise<void> {
    let { document, nvim } = this
    if (!this.isActivted || !document || !item.hasOwnProperty('word')) return
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
      let mode = await nvim.call('mode')
      if (mode != 'i' || this.insertCharTs != timestamp || this.insertLeaveTs != insertLeaveTs) return
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
    let doc = workspace.getDocument(bufnr)
    if (doc) doc.forceSync(true)
    this.stop()
  }

  private async onInsertEnter(): Promise<void> {
    if (!this.config.triggerAfterInsertEnter) return
    let option = await this.nvim.call('coc#util#get_complete_option')
    if (option && option.input.length >= this.config.minTriggerInputLength) {
      await this.startCompletion(option)
    }
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

  public async shouldTrigger(document: Document, pre: string): Promise<boolean> {
    if (pre.length == 0 || /\s/.test(pre[pre.length - 1])) return false
    let autoTrigger = this.config.autoTrigger
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, document.filetype)) return true
    if (autoTrigger !== 'always') return false
    if (document.isWord(pre.slice(-1))) {
      let minLength = this.config.minTriggerInputLength
      if (minLength == 1) return true
      let input = this.getInput(document, pre)
      return input.length >= minLength
    }
    return false
  }

  public async onPumChange(ev: PopupChangeEvent): Promise<void> {
    if (!this.activted) return
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = null
    }
    if (this.floatTokenSource) {
      this.floatTokenSource.cancel()
      this.floatTokenSource = null
    }
    let { completed_item, col, row, height, width, scrollbar } = ev
    let bounding: PumBounding = { col, row, height, width, scrollbar }
    this.currItem = completed_item.hasOwnProperty('word') ? completed_item : null
    // it's pum change by vim, ignore it
    if (this.lastInsert) return
    let resolvedItem = this.getCompleteItem(completed_item)
    if (!resolvedItem) {
      this.closePreviewWindow()
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
      this.closePreviewWindow()
    } else {
      if (this.previewBuffer) {
        let valid = await this.previewBuffer.valid
        if (!valid) this.previewBuffer = null
      }
      if (!this.previewBuffer) await this.createPreviewBuffer()
      if (!this.floating) {
        let srcId = workspace.createNameSpace('coc-pum-float')
        let chars = new Chars(this.config.previewIsKeyword)
        let config = { srcId, maxPreviewWidth: this.config.maxPreviewWidth, chars }
        this.floating = new FloatingWindow(this.nvim, this.previewBuffer, config)
      }
      if (token.isCancellationRequested || !this.isActivted) return
      this.floatTokenSource = new CancellationTokenSource()
      await this.floating.show(docs, bounding, this.floatTokenSource.token)
    }
    this.resolveTokenSource = null
  }

  private async createPreviewBuffer(): Promise<void> {
    let buf = this.previewBuffer = await this.nvim.createNewBuffer(false, true)
    await buf.setOption('buftype', 'nofile')
    await buf.setOption('bufhidden', 'hide')
  }

  public start(complete: Complete): void {
    let { activted } = this
    this.activted = true
    this.isResolving = false
    if (activted) {
      this.complete.dispose()
    }
    this.complete = complete
    if (!this.config.keepCompleteopt) {
      this.nvim.command(`noa set completeopt=${this.completeOpt}`, true)
    }
    this.document.forceSync(true)
    this.document.paused = true
  }

  public stop(): void {
    let { nvim } = this
    if (!this.activted) return
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = null
    }
    if (this.floatTokenSource) {
      this.floatTokenSource.cancel()
      this.floatTokenSource = null
    }
    this.currItem = null
    this.activted = false
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

  private closePreviewWindow(): void {
    if (this.floating) {
      this.nvim.call('coc#util#close_popup', [], true)
      this.floating = null
    }
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
    if (!this.isActivted) return null
    return this.complete.resolveCompletionItem(item)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
