'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import events, { InsertChange, PopupChangeEvent } from '../events'
import Document from '../model/document'
import sources from '../sources'
import { CompleteOption, ConfigurationChangeEvent, ExtendedCompleteItem, FloatConfig, ISource } from '../types'
import { disposeAll } from '../util'
import { byteLength, byteSlice, characterIndex, isWord } from '../util/string'
import workspace from '../workspace'
import Complete, { CompleteConfig } from './complete'
import Floating, { PumBounding } from './floating'
import MruLoader from './mru'
import PopupMenu from './pum'
import { shouldStop } from './util'
const logger = require('../util/logger')('completion')

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  public config: CompleteConfig
  private _activated = false
  private nvim: Neovim
  private pum: PopupMenu
  private mru: MruLoader
  private pretext: string | undefined
  private changedtick: number
  private triggerTimer: NodeJS.Timer
  private popupEvent: PopupChangeEvent
  private floating: Floating
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  private resolveTokenSource: CancellationTokenSource
  private activeItems: ReadonlyArray<ExtendedCompleteItem> | undefined

  public init(): void {
    this.nvim = workspace.nvim
    this.getCompleteConfig()
    this.mru = new MruLoader(this.config.selection)
    this.pum = new PopupMenu(this.nvim, this.config, this.mru)
    workspace.onDidChangeConfiguration(this.getCompleteConfig, this, this.disposables)
    this.floating = new Floating(workspace.nvim, workspace.env.isVim)
    events.on('InsertLeave', () => {
      this.stop(true)
    }, null, this.disposables)
    events.on('CursorMovedI', (bufnr, cursor, hasInsert) => {
      if (this.triggerTimer) clearTimeout(this.triggerTimer)
      if (hasInsert || !this.option || bufnr !== this.option.bufnr) return
      if (this.option.linenr === cursor[0]) {
        let line = workspace.getDocument(bufnr).getline(cursor[0] - 1)
        let curr = characterIndex(line, cursor[1] - 1)
        let start = characterIndex(line, this.option.col)
        if (start < curr) {
          let text = line.substring(start, curr)
          if (this.selectedItem && text === this.selectedItem.word) return
          if (!this.inserted && text == this.complete?.input) return
        }
      }
      this.stop(true)
    }, null, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    events.on('MenuPopupChanged', async ev => {
      this.popupEvent = ev
      await this.onPumChange(ev)
    }, null, this.disposables)
    events.on('CompleteStop', kind => {
      this.stop(false, kind)
    }, null, this.disposables)
  }

  public get option(): CompleteOption {
    if (!this.complete) return null
    return this.complete.option
  }

  public get isActivated(): boolean {
    return this._activated
  }

  public get inserted(): boolean {
    return this.popupEvent != null && this.popupEvent.inserted
  }

  private get document(): Document | null {
    if (!this.option) return null
    return workspace.getDocument(this.option.bufnr)
  }

  private get selectedItem(): ExtendedCompleteItem | undefined {
    if (!this.popupEvent || !this.activeItems) return undefined
    return this.activeItems[this.popupEvent.index]
  }

  private getCompleteConfig(e?: ConfigurationChangeEvent): CompleteConfig {
    if (e && !e.affectsConfiguration('suggest')) return
    let suggest = workspace.getConfiguration('suggest')
    function getConfig<T>(key, defaultValue: T): T {
      return suggest.get<T>(key, defaultValue)
    }
    let acceptSuggestionOnCommitCharacter = getConfig<boolean>('acceptSuggestionOnCommitCharacter', false)
    this.config = Object.assign(this.config ?? {}, {
      autoTrigger: getConfig<string>('autoTrigger', 'always'),
      selection: getConfig<'none' | 'recentlyUsed' | 'recentlyUsedByPrefix'>('selection', 'recentlyUsed'),
      floatConfig: getConfig<FloatConfig>('floatConfig', {}),
      defaultSortMethod: getConfig<string>('defaultSortMethod', 'length'),
      removeDuplicateItems: getConfig<boolean>('removeDuplicateItems', false),
      disableMenuShortcut: getConfig<boolean>('disableMenuShortcut', false),
      acceptSuggestionOnCommitCharacter,
      triggerCompletionWait: getConfig<number>('triggerCompletionWait', 0),
      labelMaxLength: getConfig<number>('labelMaxLength', 200),
      triggerAfterInsertEnter: getConfig<boolean>('triggerAfterInsertEnter', false),
      maxItemCount: getConfig<number>('maxCompleteItemCount', 50),
      timeout: getConfig<number>('timeout', 500),
      minTriggerInputLength: getConfig<number>('minTriggerInputLength', 1),
      snippetIndicator: getConfig<string>('snippetIndicator', '~'),
      ambiguousIsNarrow: getConfig<boolean>('ambiguousIsNarrow', true),
      fixInsertedWord: getConfig<boolean>('fixInsertedWord', true),
      localityBonus: getConfig<boolean>('localityBonus', true),
      highPrioritySourceLimit: getConfig<number>('highPrioritySourceLimit', null),
      lowPrioritySourceLimit: getConfig<number>('lowPrioritySourceLimit', null),
      ignoreRegexps: getConfig<string[]>('ignoreRegexps', []),
      asciiCharactersOnly: getConfig<boolean>('asciiCharactersOnly', false)
    })
  }

  public stop(close: boolean, kind?: 'cancel' | 'confirm'): void {
    if (!this._activated) return
    let inserted = this.popupEvent?.inserted
    this._activated = false
    let doc = this.document
    let input = this.complete.input
    let option = this.complete.option
    let item = this.selectedItem
    events.completing = false
    this.activeItems = undefined
    this.popupEvent = undefined
    this.cancel()
    if (item && (inserted || kind === 'confirm') && kind !== 'cancel') {
      this.mru.add(input, item)
    }
    if (close) {
      this.nvim.call('coc#pum#close', ['', 1], true)
      this.nvim.redrawVim()
    }
    if (doc && doc.attached) doc._forceSync()
    if (kind == 'confirm' && item) {
      void this.confirmCompletion(item, option)
    }
  }

  private async confirmCompletion(item: ExtendedCompleteItem, option: CompleteOption): Promise<void> {
    let source = new CancellationTokenSource()
    let { token } = source
    await this.doCompleteResolve(item, source)
    if (token.isCancellationRequested) return
    await this.doCompleteDone(item, option)
  }

  public async startCompletion(option: CompleteOption, sourceList?: ISource[]): Promise<void> {
    try {
      let doc = workspace.getAttachedDocument(option.bufnr)
      option.filetype = doc.filetype
      logger.debug('trigger completion with', option)
      this.stop(true)
      this.pretext = byteSlice(option.line, 0, option.colnr - 1)
      sourceList = sourceList ?? this.getSources(option)
      if (!sourceList || sourceList.length === 0) return
      events.completing = true
      this._activated = true
      this.changedtick = option.changedtick
      let complete = this.complete = new Complete(
        option,
        doc,
        this.config,
        sourceList,
        this.nvim)
      complete.onDidRefresh(async () => {
        if (this.triggerTimer != null) {
          clearTimeout(this.triggerTimer)
        }
        if (complete.isEmpty) {
          this.stop(false)
          return
        }
        if (this.inserted) return
        await this.filterResults()
      })
      let cancelled = await complete.doComplete()
      if (cancelled) this.stop(false)
    } catch (e) {
      this.stop(true)
      this.nvim.echoError(e)
    }
  }

  public getSources(option: CompleteOption): ISource[] {
    let { source } = option
    if (source) {
      let s = sources.getSource(source)
      return s ? [s] : []
    }
    return sources.getCompleteSources(option)
  }

  private showCompletion(items: ExtendedCompleteItem[], search: string): void {
    let { option } = this
    if (!option) return
    if (items.length == 0) {
      this.stop(true)
    } else {
      this.activeItems = items
      this.pum.show(items, search, option)
    }
  }

  private async onTextChangedI(bufnr: number, info: InsertChange): Promise<void> {
    if (!workspace.isAttached(bufnr) || this.config.autoTrigger === 'none') return
    let { option } = this
    // detect item word insert
    if (this.selectedItem && option && !info.insertChar) {
      let expected = byteSlice(option.line, 0, option.col) + this.selectedItem.word
      if (expected == info.pre) return
    }
    if (option && info.pre.match(/^\s*/)[0] !== option.line.match(/^\s*/)[0]) {
      await this.triggerCompletion(this.document, info)
      return
    }
    if (option && shouldStop(bufnr, this.pretext, info, option)) {
      this.stop(true)
      if (!info.insertChar) return
    }
    this.changedtick = info.changedtick
    if (info.pre === this.pretext) return
    if (this.triggerTimer) clearTimeout(this.triggerTimer)
    let pretext = this.pretext = info.pre
    let doc = workspace.getDocument(bufnr)
    // check commit
    if (this.config.acceptSuggestionOnCommitCharacter && this.selectedItem) {
      let last = pretext.slice(-1)
      let resolvedItem = this.selectedItem
      if (sources.shouldCommit(resolvedItem, last)) {
        logger.debug('commit by commit character.')
        let { linenr, col, line, colnr } = this.option
        this.stop(true)
        let { word } = resolvedItem
        let newLine = `${line.slice(0, col)}${word}${info.insertChar}${line.slice(colnr - 1)}`
        await this.nvim.call('coc#util#setline', [linenr, newLine])
        let curcol = col + word.length + 2
        await this.nvim.call('cursor', [linenr, curcol])
        await doc.patchChange()
        return
      }
    }
    // trigger character
    if (info.insertChar && !isWord(info.insertChar)) {
      let disabled = doc.getVar('disabled_sources', [])
      let triggerSources = sources.getTriggerSources(pretext, doc.filetype, doc.uri, disabled)
      if (triggerSources.length > 0) {
        await this.triggerCompletion(doc, info, triggerSources)
        return
      }
    }
    // trigger by normal character
    if (!this.complete) {
      if (!info.insertChar) return
      await this.triggerCompletion(doc, info)
      return
    }
    if (info.insertChar && this.complete.isEmpty) {
      // triggering without results
      this.triggerTimer = setTimeout(async () => {
        await this.triggerCompletion(doc, info)
      }, 200)
      return
    }
    await this.filterResults()
  }

  private async triggerCompletion(doc: Document, info: InsertChange, sources?: ISource[]): Promise<boolean> {
    let { minTriggerInputLength } = this.config
    let { pre } = info
    // check trigger
    if (!sources) {
      let shouldTrigger = this.shouldTrigger(doc, pre)
      if (!shouldTrigger) return false
    }
    let input = this.getInput(doc, pre)
    let option: CompleteOption = {
      input,
      line: info.line,
      filetype: doc.filetype,
      linenr: info.lnum,
      col: info.col - 1 - byteLength(input),
      colnr: info.col,
      bufnr: doc.bufnr,
      word: input + this.getPrependWord(doc, info.line.slice(pre.length)),
      changedtick: info.changedtick,
      indentkeys: doc.indentkeys,
      synname: '',
      filepath: doc.schema === 'file' ? URI.parse(doc.uri).fsPath : '',
      triggerCharacter: pre.length ? pre.slice(-1) : undefined
    }
    if (sources == null && input.length < minTriggerInputLength) {
      logger.warn(`Suggest not triggered with input "${input}", minimal trigger input length: ${minTriggerInputLength}`)
      return false
    }
    if (this.config.ignoreRegexps.length > 0 && option.input.length > 0) {
      const ignore = this.config.ignoreRegexps.some(regexp => {
        if (new RegExp(regexp).test(option.input)) {
          logger.warn(`Suggest disabled by ignore regexp: ${regexp}`)
          return true
        }
      })
      if (ignore) return false
    }
    // if (pre.length) option.triggerCharacter = pre[pre.length - 1]
    await this.startCompletion(option, sources)
    return true
  }

  private doCompleteResolve(item: ExtendedCompleteItem, tokenSource: CancellationTokenSource): Promise<void> {
    let source = sources.getSource(item.source)
    return new Promise<void>(resolve => {
      if (source && typeof source.onCompleteResolve === 'function') {
        let timer = setTimeout(() => {
          tokenSource.cancel()
          logger.warn(`Resolve timeout after 500ms: ${source.name}`)
          resolve()
        }, 500)
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
    let source = sources.getSource(item.source)
    if (source && typeof source.onCompleteDone === 'function') {
      await Promise.resolve(source.onCompleteDone(item, opt))
    }
  }

  private async onInsertEnter(bufnr: number): Promise<void> {
    if (!this.config.triggerAfterInsertEnter || this.config.autoTrigger !== 'always') return
    if (!workspace.isAttached(bufnr)) return
    let change = await this.nvim.call('coc#util#change_info') as InsertChange
    change.pre = byteSlice(change.line, 0, change.col - 1)
    if (!change.pre) return
    let doc = workspace.getDocument(bufnr)
    await this.triggerCompletion(doc, change)
  }

  public shouldTrigger(doc: Document, pre: string): boolean {
    let { autoTrigger } = this.config
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, doc.filetype, doc.uri)) return true
    if (autoTrigger !== 'always') return false
    return true
  }

  private async onPumChange(ev: PopupChangeEvent): Promise<void> {
    let { col, row, height, width, scrollbar } = ev
    let bounding: PumBounding = { col, row, height, width, scrollbar }
    let resolvedItem = this.selectedItem
    this.cancelResolve()
    if (!resolvedItem) {
      this.floating.close()
      return
    }
    if (!ev.move && this.complete?.isCompleting) return
    let source = this.resolveTokenSource = new CancellationTokenSource()
    let { token } = source
    await this.doCompleteResolve(resolvedItem, source)
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
      let excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument')
      let config = Object.assign({}, this.config.floatConfig, { excludeImages })
      this.floating.show(docs, bounding, config)
    }
  }

  private cancelResolve(): void {
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource.dispose()
      this.resolveTokenSource = null
    }
  }

  public getInput(document: Document, pre: string): string {
    let { asciiCharactersOnly } = this.config
    let len = 0
    for (let i = pre.length - 1; i >= 0; i--) {
      let ch = pre[i]
      let word = document.isWord(ch) && (asciiCharactersOnly ? ch.charCodeAt(0) < 255 : true)
      if (word) {
        len += 1
      } else {
        break
      }
    }
    return len == 0 ? '' : pre.slice(-len)
  }

  private getPrependWord(document: Document, remain: string): string {
    let idx = 0
    for (let i = 0; i < remain.length; i++) {
      if (document.isWord(remain[i])) {
        idx = i + 1
      } else {
        break
      }
    }
    return idx == 0 ? '' : remain.slice(0, idx)
  }

  public getResumeInput(): string {
    let { option, pretext, document } = this
    if (!option || !document) return null
    let buf = Buffer.from(pretext, 'utf8')
    if (buf.length < option.colnr - 1) return null
    let pre = byteSlice(option.line, 0, option.colnr - 1)
    if (!pretext.startsWith(pre)) return null
    let remain = pretext.slice(pre.length)
    if (remain.includes(' ')) return null
    return buf.slice(option.col).toString('utf8')
  }

  private async filterResults(): Promise<void> {
    let { complete } = this
    let search = this.getResumeInput()
    if (search == null) {
      this.stop(true)
      return
    }
    let items = await complete.filterResults(search)
    // cancelled
    if (items === undefined) return
    if (items.length == 0) {
      if (!complete.isCompleting) this.stop(true)
      return
    }
    this.showCompletion(items, search)
  }

  private cancel(): void {
    if (this.complete != null) {
      this.complete.dispose()
      this.complete = null
    }
    if (this.triggerTimer != null) {
      clearTimeout(this.triggerTimer)
      this.triggerTimer = null
    }
    this.cancelResolve()
    this.pretext = undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
