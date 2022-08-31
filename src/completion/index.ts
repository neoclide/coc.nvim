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
import Floating from './floating'
import MruLoader, { Selection } from './mru'
import PopupMenu from './pum'
import { getInput, getPrependWord, getSources, shouldIndent, shouldStop, toCompleteDoneItem } from './util'
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
  private triggerTimer: NodeJS.Timer
  private popupEvent: PopupChangeEvent
  private floating: Floating
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  public activeItems: ReadonlyArray<ExtendedCompleteItem> | undefined

  public init(): void {
    this.nvim = workspace.nvim
    this.getCompleteConfig()
    this.mru = new MruLoader(this.config.selection)
    this.pum = new PopupMenu(this.nvim, this.config, this.mru)
    workspace.onDidChangeConfiguration(this.getCompleteConfig, this, this.disposables)
    this.floating = new Floating(workspace.nvim)
    if (this.config.autoTrigger !== 'none') {
      workspace.nvim.call('coc#ui#check_pum_keymappings', [], true)
    }
    events.on('CursorMovedI', (bufnr, cursor, hasInsert) => {
      if (this.triggerTimer) clearTimeout(this.triggerTimer)
      if (hasInsert || !this.option || bufnr !== this.option.bufnr) return
      if (this.option.linenr === cursor[0]) {
        if (cursor[1] == this.option.colnr && cursor[1] === byteLength(this.pretext ?? '') + 1) {
          return
        }
        let line = workspace.getDocument(bufnr).getline(cursor[0] - 1)
        let curr = characterIndex(line, cursor[1] - 1)
        let start = characterIndex(line, this.option.col)
        if (start < curr) {
          let text = line.substring(start, curr)
          if (this.selectedItem && text === this.selectedItem.word) return
          if (!this.inserted && text == this.complete?.input) return
          // TODO retrigger when input moved left or right
        }
      }
      this.stop(true)
    }, null, this.disposables)
    events.on('InsertLeave', () => {
      this.stop(true)
    }, null, this.disposables)
    events.on('CompleteStop', (kind, pretext) => {
      this.stop(false, kind, pretext)
    }, null, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    events.on('TextChangedP', this.onTextChangedP, this, this.disposables)
    events.on('MenuPopupChanged', async ev => {
      if (!this.option) return
      this.popupEvent = ev
      this.floating.cancel()
      let item = this.selectedItem
      if (!item || (!ev.move && this.complete?.isCompleting)) return
      let config = this.config.floatConfig
      await this.floating.resolveItem(item, config, this.option)
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

  public get selectedItem(): ExtendedCompleteItem | undefined {
    if (!this.popupEvent || !this.activeItems) return undefined
    return this.activeItems[this.popupEvent.index]
  }

  private getCompleteConfig(e?: ConfigurationChangeEvent): CompleteConfig {
    if (e && !e.affectsConfiguration('suggest')) return
    let suggest = workspace.getConfiguration('suggest')
    function getConfig<T>(key, defaultValue: T): T {
      return suggest.get<T>(key, defaultValue)
    }
    this.config = Object.assign(this.config ?? {}, {
      ambiguousIsNarrow: workspace.env.ambiguousIsNarrow,
      pumwidth: workspace.env.pumwidth || 15,
      noselect: getConfig<boolean>('noselect', false),
      enablePreselect: getConfig<boolean>('enablePreselect', true),
      formatItems: getConfig<string[]>('formatItems', ['abbr', 'menu', 'kind', 'shortcut']),
      autoTrigger: getConfig<string>('autoTrigger', 'always'),
      virtualText: getConfig<boolean>('virtualText', false),
      selection: getConfig<Selection>('selection', 'first'),
      floatConfig: getConfig<FloatConfig>('floatConfig', {}),
      pumFloatConfig: getConfig<FloatConfig>('pumFloatConfig', null),
      defaultSortMethod: getConfig<string>('defaultSortMethod', 'length'),
      removeDuplicateItems: getConfig<boolean>('removeDuplicateItems', false),
      acceptSuggestionOnCommitCharacter: getConfig<boolean>('acceptSuggestionOnCommitCharacter', false),
      triggerCompletionWait: getConfig<number>('triggerCompletionWait', 0),
      labelMaxLength: getConfig<number>('labelMaxLength', 200),
      triggerAfterInsertEnter: getConfig<boolean>('triggerAfterInsertEnter', false),
      maxItemCount: getConfig<number>('maxCompleteItemCount', 50),
      timeout: getConfig<number>('timeout', 500),
      minTriggerInputLength: getConfig<number>('minTriggerInputLength', 1),
      snippetIndicator: getConfig<string>('snippetIndicator', '~'),
      fixInsertedWord: getConfig<boolean>('fixInsertedWord', true),
      localityBonus: getConfig<boolean>('localityBonus', true),
      highPrioritySourceLimit: getConfig<number>('highPrioritySourceLimit', null),
      lowPrioritySourceLimit: getConfig<number>('lowPrioritySourceLimit', null),
      ignoreRegexps: getConfig<string[]>('ignoreRegexps', []),
      asciiMatch: getConfig<boolean>('asciiMatch', true),
      asciiCharactersOnly: getConfig<boolean>('asciiCharactersOnly', false),
      reversePumAboveCursor: getConfig<boolean>('reversePumAboveCursor', false)
    })
  }

  public async startCompletion(option: CompleteOption, sourceList?: ISource[]): Promise<void> {
    let doc = workspace.getAttachedDocument(option.bufnr)
    option.filetype = doc.filetype
    logger.debug('trigger completion with', option)
    this.stop(true)
    this.pretext = byteSlice(option.line, 0, option.colnr - 1)
    sourceList = sourceList ?? getSources(option)
    if (!sourceList || sourceList.length === 0) return
    let complete = this.complete = new Complete(
      option,
      doc,
      this.config,
      sourceList,
      this.nvim)
    this._activated = true
    events.completing = true
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
    let shouldStop = await complete.doComplete()
    if (shouldStop) this.stop(false)
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

  private async onTextChangedP(bufnr: number, info: InsertChange): Promise<void> {
    if (this.option && bufnr === this.option.bufnr) {
      this.pretext = info.pre
    }
  }

  private async onTextChangedI(bufnr: number, info: InsertChange): Promise<void> {
    if (!workspace.isAttached(bufnr)) return
    let { option } = this
    // detect item word insert
    if (!info.insertChar && option) {
      let pre = byteSlice(option.line, 0, option.col)
      if (this.selectedItem) {
        if (pre + this.popupEvent.word == info.pre) {
          this.pretext = info.pre
          return
        }
      } else if (pre + this.pum.search == info.pre) {
        return
      }
    }
    // retrigger after indent
    if (option && info.pre.match(/^\s*/)[0] !== option.line.match(/^\s*/)[0]) {
      await this.triggerCompletion(this.document, info)
      return
    }
    if (option && shouldStop(bufnr, this.pretext, info, option)) {
      this.stop(true)
      if (!info.insertChar) return
    }
    if (info.pre === this.pretext) return
    if (this.triggerTimer) clearTimeout(this.triggerTimer)
    let pretext = this.pretext = info.pre
    let doc = workspace.getDocument(bufnr)
    // check commit
    if (info.insertChar && this.config.acceptSuggestionOnCommitCharacter && this.selectedItem) {
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
    let { minTriggerInputLength, asciiCharactersOnly, autoTrigger } = this.config
    if (autoTrigger === 'none') return false
    let { pre } = info
    // check trigger
    if (!sources) {
      let shouldTrigger = this.shouldTrigger(doc, pre)
      if (!shouldTrigger) return false
    }
    let input = getInput(doc, pre, asciiCharactersOnly)
    let option: CompleteOption = {
      input,
      line: info.line,
      filetype: doc.filetype,
      linenr: info.lnum,
      col: info.col - 1 - byteLength(input),
      colnr: info.col,
      bufnr: doc.bufnr,
      word: input + getPrependWord(doc, info.line.slice(pre.length)),
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

  public stop(close: boolean, kind: 'cancel' | 'confirm' | '' = '', pretext?: string): void {
    if (!this._activated) return
    let inserted = kind === 'confirm' || (this.popupEvent?.inserted && kind != 'cancel')
    this._activated = false
    pretext = pretext ?? this.pretext
    let doc = this.document
    let input = this.complete.input
    let option = this.complete.option
    let item = this.selectedItem
    events.completing = false
    this.cancel()
    let indent = false
    void events.fire('CompleteDone', [toCompleteDoneItem(item)])
    if (item && inserted) {
      this.mru.add(input, item)
      indent = pretext && shouldIndent(option.indentkeys, pretext)
    }
    if (close) this.nvim.call('coc#pum#_close', [], true)
    if (!doc || !doc.attached) return
    doc._forceSync()
    if (kind == 'confirm' && item) {
      void this.confirmCompletion(item, option).then(() => {
        if (indent) this.nvim.call('coc#complete_indent', [], true)
      })
    }
  }

  private async confirmCompletion(item: ExtendedCompleteItem, option: CompleteOption): Promise<void> {
    let source = new CancellationTokenSource()
    let { token } = source
    await this.floating.doCompleteResolve(item, option, source)
    if (token.isCancellationRequested) return
    await this.doCompleteDone(item, option)
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
    this.floating.cancel()
    this.pretext = undefined
    this.activeItems = undefined
    this.popupEvent = undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
