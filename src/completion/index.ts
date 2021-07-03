import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events, { PopupChangeEvent, InsertChange } from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteOption, ISource, RecentScore, VimCompleteItem, ExtendedCompleteItem } from '../types'
import { disposeAll, wait } from '../util'
import * as Is from '../util/is'
import workspace from '../workspace'
import Complete, { CompleteConfig } from './complete'
import Floating, { PumBounding } from './floating'
import debounce from 'debounce'
import { byteSlice } from '../util/string'
import { equals } from '../util/object'
const logger = require('../util/logger')('completion')
const completeItemKeys = ['abbr', 'menu', 'info', 'kind', 'icase', 'dup', 'empty', 'user_data']

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  public config: CompleteConfig
  private popupEvent: PopupChangeEvent
  private triggerTimer: NodeJS.Timer
  private floating: Floating
  // current input string
  private activated = false
  private input: string
  private lastInsert?: LastInsert
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  private recentScores: RecentScore = {}
  private resolveTokenSource: CancellationTokenSource
  private pretext: string
  private changedTick = 0
  private insertCharTs = 0
  private insertLeaveTs = 0
  private excludeImages: boolean

  public init(): void {
    this.config = this.getCompleteConfig()
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('suggest')) {
        this.config = this.getCompleteConfig()
      }
    }, null, this.disposables)
    workspace.watchOption('completeopt', async (_, newValue) => {
      workspace.env.completeOpt = newValue
      if (!this.isActivated) return
      if (this.config.autoTrigger === 'always') {
        let content = await this.nvim.call('execute', ['verbose set completeopt']) as string
        let lines = content.split(/\r?\n/)
        console.error(`Some plugin change completeopt during completion: ${lines[lines.length - 1].trim()}!`)
      }
    }, this.disposables)
    this.excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument')
    this.floating = new Floating(workspace.nvim, workspace.env.isVim)
    events.on(['InsertCharPre', 'MenuPopupChanged', 'TextChangedI', 'CursorMovedI', 'InsertLeave'], () => {
      if (this.triggerTimer) {
        clearTimeout(this.triggerTimer)
        this.triggerTimer = null
      }
    }, this, this.disposables)
    events.on('InsertCharPre', this.onInsertCharPre, this, this.disposables)
    events.on('InsertLeave', this.onInsertLeave, this, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedP', this.onTextChangedP, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    let fn = debounce(this.onPumChange.bind(this), 20)
    this.disposables.push({
      dispose: () => {
        fn.clear()
      }
    })
    events.on('CompleteDone', async item => {
      this.popupEvent = null
      if (!this.activated) return
      fn.clear()
      this.cancelResolve()
      this.floating.close()
      await this.onCompleteDone(item)
    }, this, this.disposables)
    this.cancelResolve()
    events.on('MenuPopupChanged', ev => {
      if (!this.activated || this.isCommandLine) return
      if (equals(this.popupEvent, ev)) return
      this.cancelResolve()
      this.popupEvent = ev
      fn()
    }, this, this.disposables)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public get option(): CompleteOption {
    if (!this.complete) return null
    return this.complete.option
  }

  private get selectedItem(): VimCompleteItem | null {
    if (!this.popupEvent) return null
    let { completed_item } = this.popupEvent
    return Is.vimCompleteItem(completed_item) ? completed_item : null
  }

  private get isCommandLine(): boolean {
    return this.document?.uri.endsWith('%5BCommand%20Line%5D')
  }

  private addRecent(word: string, bufnr: number): void {
    if (!word) return
    this.recentScores[`${bufnr}|${word}`] = Date.now()
  }

  public get isActivated(): boolean {
    return this.activated
  }

  private get document(): Document | null {
    if (!this.option) return null
    return workspace.getDocument(this.option.bufnr)
  }

  private getCompleteConfig(): CompleteConfig {
    let suggest = workspace.getConfiguration('suggest')
    function getConfig<T>(key, defaultValue: T): T {
      return suggest.get<T>(key, defaultValue)
    }
    let keepCompleteopt = getConfig<boolean>('keepCompleteopt', false)
    let autoTrigger = getConfig<string>('autoTrigger', 'always')
    if (keepCompleteopt && autoTrigger != 'none') {
      let { completeOpt } = workspace
      if (!completeOpt.includes('noinsert') && !completeOpt.includes('noselect')) {
        autoTrigger = 'none'
      }
    }
    let floatEnable = workspace.floatSupported && getConfig<boolean>('floatEnable', true)
    let acceptSuggestionOnCommitCharacter = workspace.env.pumevent && getConfig<boolean>('acceptSuggestionOnCommitCharacter', false)
    return {
      autoTrigger,
      floatEnable,
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
      triggerCompletionWait: getConfig<number>('triggerCompletionWait', 100),
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
    this.pretext = byteSlice(option.line, 0, option.colnr - 1)
    try {
      await this._doComplete(option)
    } catch (e) {
      this.stop()
      logger.error('Complete error:', e.stack)
    }
  }

  private async resumeCompletion(force = false): Promise<void> {
    let { document, complete } = this
    if (!document
      || complete.isCanceled
      || !complete.results
      || complete.results.length == 0) return
    let search = this.getResumeInput()
    if (search == this.input && !force) return
    if (!search || search.endsWith(' ') || !search.startsWith(complete.input)) {
      this.stop()
      return
    }
    this.input = search
    let items: VimCompleteItem[] = []
    if (complete.isIncomplete) {
      await document.patchChange()
      let { changedtick } = document
      items = await complete.completeInComplete(search)
      if (complete.isCanceled || document.changedtick != changedtick) return
    } else {
      items = complete.filterResults(search)
    }
    if (!complete.isCompleting && items.length === 0) {
      this.stop()
      return
    }
    await this.showCompletion(complete.option.col, items)
  }

  public hasSelected(): boolean {
    if (workspace.env.pumevent) return this.selectedItem != null
    if (!this.config.noselect) return true
    return false
  }

  private async showCompletion(col: number, items: ExtendedCompleteItem[]): Promise<void> {
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
            obj[key] = item[key].replace(/\[.+\]$/, '')
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
    let { nvim, config } = this
    let doc = workspace.getDocument(option.bufnr)
    if (!doc || !doc.attached) return
    // use fixed filetype
    option.filetype = doc.filetype
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
    await doc.patchChange()
    // document get changed, not complete
    if (doc.changedtick != option.changedtick) return
    let complete = new Complete(option, doc, this.recentScores, config, arr, nvim)
    this.start(complete)
    let items = await this.complete.doComplete()
    if (complete.isCanceled) return
    if (items.length == 0 && !complete.isCompleting) {
      this.stop()
      return
    }
    complete.onDidComplete(async () => {
      if (this.selectedItem != null) return
      let search = this.getResumeInput()
      if (complete.isCanceled || search == null) return
      let { input } = this.option
      if (search == input) {
        let items = complete.filterResults(search, Math.floor(Date.now() / 1000))
        await this.showCompletion(option.col, items)
      } else {
        await this.resumeCompletion()
      }
    })
    if (items.length) {
      let search = this.getResumeInput()
      if (search == option.input) {
        await this.showCompletion(option.col, items)
      } else {
        await this.resumeCompletion(true)
      }
    }
  }

  private async onTextChangedP(bufnr: number, info: InsertChange): Promise<void> {
    let { option, document } = this
    let pretext = this.pretext = info.pre
    // avoid trigger filter on pumvisible
    if (!option || option.bufnr != bufnr || info.changedtick == this.changedTick) return
    let hasInsert = this.latestInsert != null
    this.lastInsert = null
    if (info.pre.match(/^\s*/)[0] !== option.line.match(/^\s*/)[0]) {
      // Can't handle indent change
      logger.warn('Complete stopped by indent change.')
      this.stop(false)
      return
    }
    // not handle when not triggered by character insert
    if (!hasInsert || !pretext) return
    if (sources.shouldTrigger(pretext, document.filetype, document.uri)) {
      await this.triggerCompletion(document, pretext)
    } else {
      await this.resumeCompletion()
    }
  }

  private async onTextChangedI(bufnr: number, info: InsertChange): Promise<void> {
    let { nvim, latestInsertChar, option } = this
    let noChange = this.pretext == info.pre
    let pretext = this.pretext = info.pre
    this.lastInsert = null
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    // try trigger on character type
    if (!this.activated) {
      if (!latestInsertChar) return
      let triggerSources = sources.getTriggerSources(pretext, doc.filetype, doc.uri)
      if (triggerSources.length) {
        await this.triggerCompletion(doc, this.pretext)
        return
      }
      this.triggerTimer = setTimeout(async () => {
        await this.triggerCompletion(doc, pretext)
      }, this.config.triggerCompletionWait)
      return
    }
    // Ignore change with other buffer
    if (!option || bufnr != option.bufnr) return
    if (option.linenr != info.lnum || option.col >= info.col - 1) {
      this.stop()
      return
    }
    // Completion is canceled by <C-e>
    if (noChange && !latestInsertChar) {
      this.stop(false)
      return
    }
    // Check commit character
    if (pretext
      && this.selectedItem
      && this.config.acceptSuggestionOnCommitCharacter
      && latestInsertChar) {
      let resolvedItem = this.getCompleteItem(this.selectedItem)
      let last = pretext[pretext.length - 1]
      if (sources.shouldCommit(resolvedItem, last)) {
        let { linenr, col, line, colnr } = this.option
        this.stop()
        let { word } = resolvedItem
        let newLine = `${line.slice(0, col)}${word}${latestInsertChar}${line.slice(colnr - 1)}`
        await nvim.call('coc#util#setline', [linenr, newLine])
        let curcol = col + word.length + 2
        await nvim.call('cursor', [linenr, curcol])
        await doc.patchChange()
        return
      }
    }
    // prefer trigger completion
    if (sources.shouldTrigger(pretext, doc.filetype, doc.uri)) {
      await this.triggerCompletion(doc, pretext)
    } else {
      await this.resumeCompletion()
    }
  }

  private async triggerCompletion(doc: Document, pre: string): Promise<void> {
    if (!doc || !doc.attached) {
      logger.warn('Document not attached, suggest disabled.')
      return
    }
    // check trigger
    let shouldTrigger = this.shouldTrigger(doc, pre)
    if (!shouldTrigger) return
    if (doc.getVar('suggest_disable')) {
      logger.warn(`Suggest disabled by b:coc_suggest_disable`)
      return
    }
    await doc.patchChange()
    let [disabled, option] = await this.nvim.eval('[get(b:,"coc_suggest_disable",0),coc#util#get_complete_option()]') as [number, CompleteOption]
    if (disabled == 1) {
      logger.warn(`Suggest disabled by b:coc_suggest_disable`)
      return
    }
    if (option.blacklist && option.blacklist.includes(option.input)) {
      logger.warn(`Suggest disabled by b:coc_suggest_blacklist`, option.blacklist)
      return
    }
    if (pre.length) {
      option.triggerCharacter = pre.slice(-1)
    }
    logger.debug('trigger completion with', option)
    await this.startCompletion(option)
  }

  private async onCompleteDone(item: VimCompleteItem): Promise<void> {
    let { document, isActivated } = this
    if (!isActivated || !document || !Is.vimCompleteItem(item)) return
    let opt = Object.assign({}, this.option)
    let resolvedItem = this.getCompleteItem(item)
    this.stop()
    if (!resolvedItem) return
    let timestamp = this.insertCharTs
    let insertLeaveTs = this.insertLeaveTs
    let source = new CancellationTokenSource()
    await sources.doCompleteResolve(resolvedItem, source.token)
    source.dispose()
    this.addRecent(resolvedItem.word, document.bufnr)
    // Wait possible TextChangedI
    await wait(50)
    if (this.insertCharTs != timestamp
      || this.insertLeaveTs != insertLeaveTs) return
    let [visible, lnum, pre] = await this.nvim.eval(`[pumvisible(),line('.'),strpart(getline('.'), 0, col('.') - 1)]`) as [number, number, string]
    if (visible || lnum != opt.linenr || this.activated || !pre.endsWith(resolvedItem.word)) return
    await document.patchChange()
    await sources.doCompleteDone(resolvedItem, opt)
  }

  private async onInsertLeave(): Promise<void> {
    this.insertLeaveTs = Date.now()
    this.stop(false)
  }

  private async onInsertEnter(bufnr: number): Promise<void> {
    if (!this.config.triggerAfterInsertEnter || this.config.autoTrigger !== 'always') return
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let pre = await this.nvim.eval(`strpart(getline('.'), 0, col('.') - 1)`) as string
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

  public shouldTrigger(doc: Document, pre: string): boolean {
    let autoTrigger = this.config.autoTrigger
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, doc.filetype, doc.uri)) return true
    if (autoTrigger !== 'always' || this.isActivated) return false
    let last = pre.slice(-1)
    if (last && (doc.isWord(pre.slice(-1)) || last.codePointAt(0) > 255)) {
      let minLength = this.config.minTriggerInputLength
      if (minLength == 1) return true
      let input = this.getInput(doc, pre)
      return input.length >= minLength
    }
    return false
  }

  private async onPumChange(): Promise<void> {
    if (!this.popupEvent) return
    let { col, row, height, width, scrollbar } = this.popupEvent
    let bounding: PumBounding = { col, row, height, width, scrollbar }
    let resolvedItem = this.getCompleteItem(this.selectedItem)
    if (!resolvedItem) {
      this.floating.close()
      return
    }
    let source = this.resolveTokenSource = new CancellationTokenSource()
    let { token } = source
    await sources.doCompleteResolve(resolvedItem, token)
    if (this.resolveTokenSource == source) {
      this.resolveTokenSource = null
    }
    source.dispose()
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
      if (this.config.floatEnable) {
        let source = new CancellationTokenSource()
        await this.floating.show(docs, bounding, {
          maxPreviewWidth: this.config.maxPreviewWidth,
          excludeImages: this.excludeImages
        }, source.token)
      }
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

  private cancelResolve(): void {
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = null
    }
  }

  public stop(hide = true): void {
    let { nvim } = this
    if (!this.activated) return
    this.cancelResolve()
    this.floating.close()
    this.activated = false
    if (this.complete) {
      this.complete.dispose()
      this.complete = null
    }
    nvim.pauseNotification()
    if (hide) {
      nvim.call('coc#_hide', [], true)
    }
    if (this.config.numberSelect) {
      nvim.call('coc#_unmap', [], true)
    }
    if (!this.config.keepCompleteopt) {
      nvim.command(`noa set completeopt=${workspace.completeOpt}`, true)
    }
    nvim.command(`let g:coc#_context = {'start': 0, 'preselect': -1,'candidates': []}`, true)
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

  public getResumeInput(): string {
    let { option, pretext } = this
    if (!option) return null
    let buf = Buffer.from(pretext, 'utf8')
    if (buf.length < option.col) return null
    let input = buf.slice(option.col).toString('utf8')
    if (option.blacklist && option.blacklist.includes(input)) return null
    return input
  }

  private get completeOpt(): string {
    let { noselect, enablePreview } = this.config
    let preview = enablePreview && !workspace.env.pumevent ? ',preview' : ''
    if (noselect) return `noselect,menuone${preview}`
    return `noinsert,menuone${preview}`
  }

  private getCompleteItem(item: VimCompleteItem | {} | null): ExtendedCompleteItem | null {
    if (!this.complete || !Is.vimCompleteItem(item)) return null
    return this.complete.resolveCompletionItem(item)
  }

  public dispose(): void {
    this.resolveTokenSource = null
    disposeAll(this.disposables)
  }
}

export default new Completion()
