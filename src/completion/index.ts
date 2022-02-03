import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events, { InsertChange, PopupChangeEvent } from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteOption, ExtendedCompleteItem, FloatConfig, ISource, VimCompleteItem } from '../types'
import { disposeAll, wait } from '../util'
import * as Is from '../util/is'
import { equals } from '../util/object'
import { byteLength, byteSlice } from '../util/string'
import workspace from '../workspace'
import Complete, { CompleteConfig, MruItem } from './complete'
import MruLoader from './mru'
import Floating, { PumBounding } from './floating'
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
  private completeTimer: NodeJS.Timer
  private currentSources: string[] = []
  private floating: Floating
  // current input string
  private activated = false
  // selecting complete item
  private selecting = false
  private input: string
  private lastInsert?: LastInsert
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  private resolveTokenSource: CancellationTokenSource
  private pretext = ''
  private changedTick = 0
  private insertCharTs = 0
  private insertLeaveTs = 0
  private excludeImages: boolean
  private mru: MruLoader = new MruLoader()

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
        this.nvim.echoError(`Some plugin change completeopt during completion: ${lines[lines.length - 1].trim()}!`)
      }
    }, this.disposables)
    this.excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument')
    this.floating = new Floating(workspace.nvim, workspace.env.isVim)
    events.on(['InsertCharPre', 'MenuPopupChanged', 'TextChangedI', 'CursorMovedI', 'InsertLeave'], () => {
      if (this.triggerTimer) {
        clearTimeout(this.triggerTimer)
        this.triggerTimer = null
      }
      if (this.completeTimer) {
        clearTimeout(this.completeTimer)
        this.completeTimer = null
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
      await this.onCompleteDone(item)
    }, this, this.disposables)
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
      selection: getConfig<'none' | 'recentlyUsed' | 'recentlyUsedByPrefix'>('selection', 'recentlyUsed'),
      floatConfig: getConfig<FloatConfig>('floatConfig', {}),
      defaultSortMethod: getConfig<string>('defaultSortMethod', 'length'),
      removeDuplicateItems: getConfig<boolean>('removeDuplicateItems', false),
      disableMenuShortcut: getConfig<boolean>('disableMenuShortcut', false),
      acceptSuggestionOnCommitCharacter,
      disableKind: getConfig<boolean>('disableKind', false),
      disableMenu: getConfig<boolean>('disableMenu', false),
      previewIsKeyword: getConfig<string>('previewIsKeyword', '@,48-57,_192-255'),
      enablePreview: getConfig<boolean>('enablePreview', false),
      enablePreselect: getConfig<boolean>('enablePreselect', false),
      triggerCompletionWait: getConfig<number>('triggerCompletionWait', 100),
      labelMaxLength: getConfig<number>('labelMaxLength', 200),
      triggerAfterInsertEnter: getConfig<boolean>('triggerAfterInsertEnter', false),
      noselect: getConfig<boolean>('noselect', true),
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

  /**
   * Filter or trigger new completion
   */
  private async resumeCompletion(forceRefresh = false): Promise<void> {
    let { document, complete, pretext } = this
    let search = this.getResumeInput()
    if (search == null) {
      this.stop()
      return
    }
    // not changed
    if (search == this.input && !forceRefresh) return
    let disabled = complete.option.disabled
    // TODO use this.getTriggerSources
    let triggerSources = sources.getTriggerSources(pretext, document.filetype, document.uri, disabled)
    if (search.endsWith(' ') && !triggerSources.length) {
      this.stop()
      return
    }
    let filteredSources: string[] = []
    let items: ExtendedCompleteItem[] = []
    this.input = search
    if (!complete.isEmpty) {
      if (complete.isIncomplete) {
        await document.patchChange(true)
        items = await complete.completeInComplete(search)
        if (complete.isCanceled || this.pretext !== pretext) return
      } else {
        items = complete.filterResults(search)
      }
      items.forEach(item => {
        // success filter
        if (!filteredSources.includes(item.source) && item.filterText.startsWith(search)) {
          filteredSources.push(item.source)
        }
      })
    }
    if (triggerSources.length && !triggerSources.every(s => filteredSources.includes(s.name))) {
      complete.dispose()
      // TODO direct trigger with triggerSources
      await this.triggerCompletion(document, this.pretext)
      return
    }
    if (items.length === 0 && !complete.isCompleting) {
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
    if (this.selecting) return
    this.currentSources = this.complete.resultSources
    let { disableKind, labelMaxLength, disableMenuShortcut, disableMenu } = this.config
    let preselect = this.config.enablePreselect ? items.findIndex(o => o.preselect) : -1
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
    if (!doc?.attached) return
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
    let [mruItems] = await Promise.all([
      this.mru.getRecentItems(),
      doc.patchChange(true),
    ]) as [MruItem[], undefined]
    let pre = byteSlice(option.line, 0, option.colnr - 1)
    // document get changed, not complete
    if (pre !== this.pretext) return
    let complete = new Complete(option, doc, config, arr, mruItems, nvim)
    this.start(complete)
    // Urgent refresh for complete items
    let timer = this.completeTimer = setTimeout(async () => {
      if (complete.isCanceled) return
      let items = complete.filterResults(option.input)
      if (items.length === 0 || this.sourcesExists(items)) return
      await this.showCompletion(option.col, items)
    }, 200)
    let items = await this.complete.doComplete()
    clearTimeout(timer)
    if (complete.isCanceled || this.selecting) return
    if (items.length == 0) {
      this.stop(false)
      return
    }
    let search = this.getResumeInput()
    if (this.sourcesExists(items)) return
    if (search == option.input) {
      await this.showCompletion(option.col, items)
    } else {
      await this.resumeCompletion(true)
    }
  }

  /**
   * Check if soruces of items already shown.
   */
  private sourcesExists(items: ExtendedCompleteItem[]): boolean {
    let { currentSources } = this
    if (currentSources.length == 0) return items.length == 0
    let exists = true
    for (let item of items) {
      if (!currentSources.includes(item.source)) {
        exists = false
        break
      }
    }
    return exists
  }

  private async onTextChangedP(bufnr: number, info: InsertChange): Promise<void> {
    let { option } = this
    let pretext = this.pretext = info.pre
    if (!option || option.bufnr != bufnr) return
    let hasInsert = this.latestInsert != null
    this.lastInsert = null
    if (info.pre.match(/^\s*/)[0] !== option.line.match(/^\s*/)[0]) {
      // Can't handle indent change
      logger.warn('Complete stopped by indent change.')
      this.nvim.call('coc#_cancel', [], true)
      this.stop(false)
      return
    }
    if ((hasInsert || info.changedtick == this.changedTick)
      && shouldIndent(option.indentkeys, pretext)) {
      this.nvim.call('coc#complete_indent', [], true)
      return
    }
    // avoid trigger filter on pumvisible
    if (info.changedtick == this.changedTick) return
    if (!hasInsert) this.selecting = true
    // not handle when not triggered by character insert
    if (!hasInsert || !pretext) return
    await this.resumeCompletion()
  }

  private async onTextChangedI(bufnr: number, info: InsertChange): Promise<void> {
    let { nvim, latestInsertChar, option } = this
    let pretext = this.pretext = info.pre
    this.lastInsert = null
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    // try trigger on character type
    if (!this.activated) {
      if (!latestInsertChar) return
      if (sources.shouldTrigger(pretext, doc.filetype, doc.uri)) {
        await this.triggerCompletion(doc, pretext)
        return
      }
      this.triggerTimer = setTimeout(async () => {
        if (this.activated) return
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
    // Completion canceled by <C-e> or text changed by backspace.
    if (!latestInsertChar) {
      this.stop(false)
      return
    }
    // Check commit character
    if (pretext && this.selectedItem && this.config.acceptSuggestionOnCommitCharacter) {
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
    await this.resumeCompletion()
  }

  private async triggerCompletion(doc: Document, pre: string): Promise<void> {
    if (!doc?.attached) return
    // check trigger
    let shouldTrigger = this.shouldTrigger(doc, pre)
    if (!shouldTrigger) return
    let option = await this.nvim.call('coc#util#get_complete_option') as CompleteOption
    if (!option) {
      logger.warn(`Completion of ${doc.bufnr} disabled by b:coc_suggest_disable`)
      return
    }
    if (option.blacklist && option.blacklist.includes(option.input)) {
      logger.warn(`Suggest disabled by b:coc_suggest_blacklist`, option.blacklist)
      return
    }
    if (option.input && this.config.asciiCharactersOnly) {
      option.input = this.getInput(doc, pre)
      option.col = byteLength(pre) - byteLength(option.input)
    }
    if (pre.length) {
      option.triggerCharacter = pre.slice(-1)
    }
    option.filetype = doc.filetype
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
    let now = Date.now()
    let source = new CancellationTokenSource()
    this.mru.add(this.input, resolvedItem)
    await this.doCompleteResolve(resolvedItem, source)
    source.dispose()
    // Wait possible TextChangedI
    await wait(50 - (Date.now() - now))
    let [lnum, mode, pretext] = await this.nvim.eval(`[line('.'),mode(),strpart(getline('.'),0,col('.')-1)]`) as [number, string, string]
    if (lnum !== opt.linenr || mode != 'i' || pretext !== byteSlice(opt.line, 0, opt.col) + item.word) return
    if (this.insertCharTs > now || this.activated) return
    await document.patchChange(true)
    await this.doCompleteDone(resolvedItem, opt)
  }

  private doCompleteResolve(item: ExtendedCompleteItem, tokenSource: CancellationTokenSource): Promise<void> {
    let source = sources.getSource(item.source)
    return new Promise<void>(resolve => {
      if (source && typeof source.onCompleteResolve == 'function') {
        let timer = setTimeout(() => {
          tokenSource.cancel()
          logger.warn(`Resolve timeout after 300ms: ${source.name}`)
          resolve()
        }, 300)
        Promise.resolve(source.onCompleteResolve(item, tokenSource.token)).then(() => {
          clearTimeout(timer)
          resolve()
        }, e => {
          logger.error(`Error on complete resolve: ${e.message}`, e)
          clearTimeout(timer)
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  public async doCompleteDone(item: ExtendedCompleteItem, opt: CompleteOption): Promise<void> {
    let data = JSON.parse(item.user_data)
    let source = sources.getSource(data.source)
    if (source && typeof source.onCompleteDone === 'function') {
      await Promise.resolve(source.onCompleteDone(item, opt))
    }
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
    let { autoTrigger, asciiCharactersOnly, minTriggerInputLength } = this.config
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, doc.filetype, doc.uri)) return true
    if (autoTrigger !== 'always' || this.isActivated) return false
    let last = pre.slice(-1)
    // eslint-disable-next-line no-control-regex
    if (asciiCharactersOnly && !/[\x00-\x7F]/.test(last)) {
      return false
    }
    if (last && (doc.isWord(pre.slice(-1)) || last.codePointAt(0) > 255)) {
      if (minTriggerInputLength == 1) return true
      let input = this.getInput(doc, pre)
      return input.length >= minTriggerInputLength
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
    await this.doCompleteResolve(resolvedItem, source)
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
        await this.floating.show(docs, bounding, Object.assign({}, this.config.floatConfig, {
          excludeImages: this.excludeImages
        }), source.token)
      }
      if (!this.isActivated) {
        this.floating.close()
      }
    }
  }

  public start(complete: Complete): void {
    let { activated } = this
    this.activated = true
    this.selecting = false
    this.currentSources = []
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
    if (!this.config.keepCompleteopt) {
      nvim.command(`noa set completeopt=${workspace.completeOpt}`, true)
    }
    nvim.command(`let g:coc#_context = {'start': 0, 'preselect': -1,'candidates': []}`, true)
    void nvim.resumeNotification(false, true)
  }

  public reset(): void {
    this.stop(true)
    if (this.triggerTimer) {
      clearTimeout(this.triggerTimer)
    }
    if (this.completeTimer) {
      clearTimeout(this.completeTimer)
    }
  }

  private getInput(document: Document, pre: string): string {
    let { asciiCharactersOnly } = this.config
    let input = ''
    for (let i = pre.length - 1; i >= 0; i--) {
      let ch = i == 0 ? null : pre[i - 1]
      // eslint-disable-next-line no-control-regex
      if (!ch || !document.isWord(ch) || (asciiCharactersOnly && !/[\x00-\x7F]/.test(ch))) {
        input = pre.slice(i, pre.length)
        break
      }
    }
    return input
  }

  public getResumeInput(): string {
    let { option, pretext, document } = this
    if (!option || !document) return null
    if (events.cursor && option.linenr != events.cursor.lnum) return null
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
    if (this.triggerTimer) {
      clearTimeout(this.triggerTimer)
    }
    this.resolveTokenSource = null
    disposeAll(this.disposables)
  }
}

export function shouldIndent(indentkeys = '', pretext: string): boolean {
  for (let part of indentkeys.split(',')) {
    if (part.indexOf('=') > -1) {
      let [pre, post] = part.split('=')
      let word = post.startsWith('~') ? post.slice(1) : post
      if (pretext.length < word.length ||
        (pretext.length > word.length && !/^\s/.test(pretext.slice(-word.length - 1)))) {
        continue
      }
      let matched = post.startsWith('~') ? pretext.toLowerCase().endsWith(word) : pretext.endsWith(word)
      if (!matched) {
        continue
      }
      if (pre == '') {
        return true
      }
      if (pre == '0' && (pretext.length == word.length || /^\s*$/.test(pretext.slice(0, pretext.length - word.length)))) {
        return true
      }
    }
  }
  return false
}

export default new Completion()
