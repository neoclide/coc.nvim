'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, Position } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import events, { InsertChange, PopupChangeEvent } from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import sources from '../sources'
import { CompleteOption, DurationCompleteItem, IConfigurationChangeEvent, ISource } from '../types'
import { disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { byteLength, byteSlice, characterIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import Complete, { CompleteConfig } from './complete'
import Floating from './floating'
import MruLoader from './mru'
import PopupMenu, { PopupMenuConfig } from './pum'
import { checkIgnoreRegexps, createKindMap, getInput, getResumeInput, getSources, shouldStop, toCompleteDoneItem } from './util'
const logger = createLogger('completion')
const RESOLVE_TIMEOUT = global.__TEST__ ? 50 : 500
const TRIGGER_TIMEOUT = global.__TEST__ ? 20 : 200

export interface LastInsert {
  character: string
  timestamp: number
}

export class Completion implements Disposable {
  public config: CompleteConfig
  private staticConfig: PopupMenuConfig
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
  private resolveTokenSource: CancellationTokenSource | undefined
  // Ordered items shown in the pum
  public activeItems: ReadonlyArray<DurationCompleteItem> = []

  public init(): void {
    this.nvim = workspace.nvim
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    window.onDidChangeActiveTextEditor(e => {
      this.loadLocallConfig(e.document)
    }, null, this.disposables)
    this.mru = new MruLoader()
    this.pum = new PopupMenu(this.nvim, this.staticConfig, workspace.env, this.mru)
    this.floating = new Floating(workspace.nvim, this.staticConfig)
    workspace.nvim.call('coc#ui#check_pum_keymappings', [this.config.autoTrigger], true)
    events.on('CursorMovedI', this.onCursorMovedI, this, this.disposables)
    events.on('InsertLeave', () => {
      this.stop(true)
    }, null, this.disposables)
    events.on('CompleteStop', kind => {
      this.stop(false, kind)
    }, null, this.disposables)
    events.on('InsertEnter', this.onInsertEnter, this, this.disposables)
    events.on('TextChangedI', this.onTextChangedI, this, this.disposables)
    events.on('TextChangedP', this.onTextChangedP, this, this.disposables)
    events.on('MenuPopupChanged', async ev => {
      if (!this.option) return
      this.popupEvent = ev
      let item = this.selectedItem
      if (!item || !this.config.enableFloat || (!ev.move && this.complete?.isCompleting)) return
      await this.floating.resolveItem(item, this.option, this.createResolveToken())
    }, null, this.disposables)
  }

  public onCursorMovedI(bufnr: number, cursor: [number, number], hasInsert: boolean): void {
    clearTimeout(this.triggerTimer)
    if (hasInsert || !this.option || bufnr !== this.option.bufnr) return
    let { linenr, colnr, col } = this.option
    if (linenr === cursor[0]) {
      if (cursor[1] == colnr && cursor[1] === byteLength(this.pretext ?? '') + 1) {
        return
      }
      let line = this.document.getline(cursor[0] - 1)
      if (line.match(/^\s*/)[0] !== this.option.line.match(/^\s*/)[0]) {
        return
      }
      let curr = characterIndex(line, cursor[1] - 1)
      let start = characterIndex(line, col)
      if (start < curr) {
        let text = line.substring(start, curr)
        if ((this.selectedItem && text === this.selectedItem.word)
          || (!this.inserted && text == this.complete?.input)
        ) {
          return
        }
      }
    }
    this.stop(true)
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

  public get document(): Document | null {
    if (!this.option) return null
    return workspace.getDocument(this.option.bufnr)
  }

  public get selectedItem(): DurationCompleteItem | undefined {
    if (!this.popupEvent) return undefined
    return this.activeItems[this.popupEvent.index]
  }

  /**
   * Configuration for current document
   */
  private loadLocallConfig(doc?: Document): void {
    let suggest = workspace.getConfiguration('suggest', doc)
    this.config = {
      autoTrigger: suggest.get<string>('autoTrigger', 'always'),
      filterGraceful: suggest.get<boolean>('filterGraceful', true),
      enableFloat: suggest.get<boolean>('enableFloat', true),
      languageSourcePriority: suggest.get<number>('languageSourcePriority', 99),
      snippetsSupport: suggest.get<boolean>('snippetsSupport', true),
      defaultSortMethod: suggest.get<string>('defaultSortMethod', 'length'),
      removeDuplicateItems: suggest.get<boolean>('removeDuplicateItems', false),
      acceptSuggestionOnCommitCharacter: suggest.get<boolean>('acceptSuggestionOnCommitCharacter', false),
      triggerCompletionWait: suggest.get<number>('triggerCompletionWait', 0),
      triggerAfterInsertEnter: suggest.get<boolean>('triggerAfterInsertEnter', false),
      maxItemCount: suggest.get<number>('maxCompleteItemCount', 256),
      timeout: suggest.get<number>('timeout', 500),
      minTriggerInputLength: suggest.get<number>('minTriggerInputLength', 1),
      localityBonus: suggest.get<boolean>('localityBonus', true),
      highPrioritySourceLimit: suggest.get<number>('highPrioritySourceLimit', null),
      lowPrioritySourceLimit: suggest.get<number>('lowPrioritySourceLimit', null),
      ignoreRegexps: suggest.get<string[]>('ignoreRegexps', []),
      asciiMatch: suggest.get<boolean>('asciiMatch', true),
      asciiCharactersOnly: suggest.get<boolean>('asciiCharactersOnly', false),
    }
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): CompleteConfig {
    if (e && !e.affectsConfiguration('suggest')) return
    if (e) this.pum.reset()
    let suggest = workspace.getConfiguration('suggest', null)
    let labels = suggest.get<{ [key: string]: string }>('completionItemKindLabels', {})
    this.staticConfig = Object.assign(this.staticConfig ?? {}, {
      kindMap: createKindMap(labels),
      defaultKindText: labels['default'] ?? '',
      detailField: suggest.detailField,
      detailMaxLength: suggest.detailMaxLength ?? 100,
      invalidInsertCharacters: suggest.invalidInsertCharacters ?? [],
      formatItems: suggest.formatItems,
      floatConfig: suggest.floatConfig ?? {},
      pumFloatConfig: suggest.pumFloatConfig,
      labelMaxLength: suggest.labelMaxLength,
      reversePumAboveCursor: !!suggest.reversePumAboveCursor,
      snippetIndicator: suggest.snippetIndicator ?? '~',
      noselect: !!suggest.noselect,
      fixInsertedWord: !!suggest.fixInsertedWord,
      enablePreselect: !!suggest.enablePreselect,
      virtualText: !!suggest.virtualText,
      selection: suggest.selection
    })
    let doc = workspace.getDocument(workspace.bufnr)
    this.loadLocallConfig(doc)
  }

  public async startCompletion(option: CompleteOption, sourceList?: ISource[]): Promise<void> {
    let doc = workspace.getAttachedDocument(option.bufnr)
    option.filetype = doc.filetype
    logger.debug('trigger completion with', option)
    this.stop(true)
    this.pretext = byteSlice(option.line, 0, option.colnr - 1)
    sourceList = sourceList ?? getSources(option)
    if (isFalsyOrEmpty(sourceList)) return
    let complete = this.complete = new Complete(
      option,
      doc,
      this.config,
      sourceList,
      this.nvim)
    this._activated = true
    events.completing = true
    complete.onDidRefresh(async () => {
      clearTimeout(this.triggerTimer)
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

  private async onTextChangedP(bufnr: number, info: InsertChange): Promise<void> {
    if (bufnr !== this.option?.bufnr) return
    // navigate item or finish completion
    if (!info.insertChar && this.complete) {
      this.complete.cancel()
    }
    this.pretext = info.pre
  }

  private async onTextChangedI(bufnr: number, info: InsertChange): Promise<void> {
    const doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return
    const { option } = this
    if (option != null) {
      // detect item word insert
      if (!info.insertChar) {
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
      if (info.pre.match(/^\s*/)[0] !== option.line.match(/^\s*/)[0]) {
        await this.triggerCompletion(doc, info)
        return
      }
      if (shouldStop(bufnr, this.pretext, info, option)) {
        this.stop(true)
      }
    }
    if (info.pre === this.pretext) return
    clearTimeout(this.triggerTimer)
    let pretext = this.pretext = info.pre
    if (!info.insertChar) {
      if (this.complete) await this.filterResults()
      return
    }
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
    if (!doc.chars.isKeywordChar(info.insertChar)) {
      let triggerSources = this.getTriggerSources(doc, pretext)
      if (triggerSources.length > 0) {
        await this.triggerCompletion(doc, info, triggerSources)
        return
      }
    }
    // trigger by normal character
    if (!this.complete) {
      await this.triggerCompletion(doc, info)
      return
    }
    if (this.complete.isEmpty) {
      // triggering without results
      this.triggerTimer = setTimeout(async () => {
        await this.triggerCompletion(doc, info)
      }, TRIGGER_TIMEOUT)
      return
    }
    await this.filterResults(info)
  }

  private getTriggerSources(doc: Document, pretext: string): ISource[] {
    let disabled = doc.getVar('disabled_sources', [])
    return sources.getTriggerSources(pretext, doc.filetype, doc.uri, disabled)
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
    let followWord = doc.getStartWord(info.line.slice(info.pre.length))
    let option: CompleteOption = {
      input,
      position: Position.create(info.lnum - 1, info.pre.length),
      line: info.line,
      followWord,
      filetype: doc.filetype,
      linenr: info.lnum,
      col: info.col - 1 - byteLength(input),
      colnr: info.col,
      bufnr: doc.bufnr,
      word: input + followWord,
      changedtick: info.changedtick,
      synname: '',
      filepath: doc.schema === 'file' ? URI.parse(doc.uri).fsPath : '',
      triggerCharacter: pre.length ? pre.slice(-1) : undefined
    }
    if (sources == null && input.length < minTriggerInputLength) {
      logger.trace(`Suggest not triggered with input "${input}", minimal trigger input length: ${minTriggerInputLength}`)
      return false
    }
    if (checkIgnoreRegexps(this.config.ignoreRegexps, option.input)) return false
    await this.startCompletion(option, sources)
    return true
  }

  public stop(close: boolean, kind: 'cancel' | 'confirm' | '' = ''): void {
    if (!this._activated) return
    let inserted = kind === 'confirm' || (this.popupEvent?.inserted && kind != 'cancel')
    this._activated = false
    let doc = this.document
    let input = this.complete.input
    let option = this.complete.option
    let item = this.selectedItem
    events.completing = false
    this.cancel()
    void events.fire('CompleteDone', [toCompleteDoneItem(item)])
    if (item && inserted) this.mru.add(input, item)
    if (close) this.nvim.call('coc#pum#_close', [], true)
    doc._forceSync()
    if (kind == 'confirm' && item) {
      void this.confirmCompletion(item, option)
    }
  }

  private async confirmCompletion(item: DurationCompleteItem, option: CompleteOption): Promise<void> {
    let token = this.createResolveToken()
    await this.floating.doCompleteResolve(item, option, token)
    // clear the timeout
    this.resolveTokenSource?.cancel()
    await this.doCompleteDone(item, option)
  }

  public async doCompleteDone(item: DurationCompleteItem, opt: CompleteOption): Promise<void> {
    let source = sources.getSource(item.source)
    if (typeof source?.onCompleteDone !== 'function') return
    await Promise.resolve(source.onCompleteDone(item, opt, this.config.snippetsSupport))
  }

  private createResolveToken(): CancellationToken {
    let tokenSource = this.resolveTokenSource = new CancellationTokenSource()
    let timer = setTimeout(() => {
      if (this.resolveTokenSource === tokenSource) {
        tokenSource.cancel()
        this.resolveTokenSource = undefined
      }
    }, RESOLVE_TIMEOUT)
    tokenSource.token.onCancellationRequested(() => {
      clearTimeout(timer)
    })
    return tokenSource.token
  }

  private async onInsertEnter(bufnr: number): Promise<void> {
    if (!this.config.triggerAfterInsertEnter || this.config.autoTrigger !== 'always') return
    let change = await this.nvim.call('coc#util#change_info') as InsertChange
    change.pre = byteSlice(change.line, 0, change.col - 1)
    let doc = workspace.getDocument(bufnr)
    if (doc && doc.attached) await this.triggerCompletion(doc, change)
  }

  public shouldTrigger(doc: Document, pre: string): boolean {
    let { autoTrigger } = this.config
    if (autoTrigger == 'none') return false
    if (sources.shouldTrigger(pre, doc.filetype, doc.uri)) return true
    if (autoTrigger !== 'always') return false
    return true
  }

  private async filterResults(info?: InsertChange): Promise<void> {
    let { complete, option, pretext } = this
    let search = getResumeInput(option, pretext)
    if (search == null) {
      this.stop(true)
      return
    }
    let items = await complete.filterResults(search)
    // cancelled or have inserted text
    if (items === undefined || !this.option) return
    let doc = workspace.getDocument(option.bufnr)
    // trigger completion when trigger source available
    if (info && info.insertChar && items.length == 0) {
      let triggerSources = this.getTriggerSources(doc, pretext)
      if (triggerSources.length > 0) {
        await this.triggerCompletion(doc, info, triggerSources)
        return
      }
    }
    if (items.length == 0) {
      let last = search.slice(-1)
      if (!complete.isCompleting || last.length === 0 || !doc.chars.isKeywordChar(last)) {
        this.stop(true)
      }
      return
    }
    this.activeItems = items
    this.pum.show(items, search, this.option)
  }

  public cancel(): void {
    if (this.complete != null) {
      this.complete.dispose()
      this.complete = null
    }
    if (this.triggerTimer != null) {
      clearTimeout(this.triggerTimer)
      this.triggerTimer = null
    }
    this.pretext = undefined
    this.activeItems = []
    this.popupEvent = undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new Completion()
