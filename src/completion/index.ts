'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import type { IConfigurationChangeEvent } from '../configuration/types'
import events, { InsertChange, PopupChangeEvent } from '../events'
import { createLogger } from '../logger'
import type Document from '../model/document'
import { defaultValue, disposeAll, getConditionValue } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import * as Is from '../util/is'
import { debounce } from '../util/node'
import { toNumber } from '../util/numbers'
import { toObject } from '../util/object'
import type { Disposable } from '../util/protocol'
import { byteIndex, byteLength, byteSlice, characterIndex, toText } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import Complete from './complete'
import Floating from './floating'
import PopupMenu, { PopupMenuConfig } from './pum'
import sources from './sources'
import { CompleteConfig, CompleteDoneOption, CompleteFinishKind, CompleteItem, CompleteOption, DurationCompleteItem, InsertMode, ISource, SortMethod } from './types'
import { checkIgnoreRegexps, createKindMap, getInput, getResumeInput, MruLoader, shouldStop, toCompleteDoneItem } from './util'
const logger = createLogger('completion')
const TRIGGER_TIMEOUT = getConditionValue(200, 20)
const CURSORMOVE_DEBOUNCE = getConditionValue(10, 0)

export class Completion implements Disposable {
  public config: CompleteConfig
  private staticConfig: PopupMenuConfig
  private pum: PopupMenu
  private _mru: MruLoader
  private pretext: string | undefined
  private triggerTimer: NodeJS.Timer
  private popupEvent: PopupChangeEvent
  private floating: Floating
  private disposables: Disposable[] = []
  private complete: Complete | null = null
  private _debounced: ((bufnr: number, cursor: [number, number], hasInsert: boolean) => void) & { clear(): void }
  // Ordered items shown in the pum
  public activeItems: ReadonlyArray<DurationCompleteItem> = []

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public init(): void {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    window.onDidChangeActiveTextEditor(e => {
      this.loadLocalConfig(e.document)
    }, null, this.disposables)
    this._mru = new MruLoader()
    this.pum = new PopupMenu(this.staticConfig, this._mru)
    this.floating = new Floating(this.staticConfig)
    this._debounced = debounce(this.onCursorMovedI.bind(this), CURSORMOVE_DEBOUNCE)
    events.on('CursorMoved', () => {
      this.stop(true)
    }, null, this.disposables)
    events.on('CursorMovedI', this._debounced, this, this.disposables)
    events.on('CursorMovedI', () => {
      clearTimeout(this.triggerTimer)
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
      let resolved = this.complete.resolveItem(this.selectedItem)
      if (!resolved || (!ev.move && this.complete.isCompleting)) return
      let detailRendered = this.selectedItem.detailRendered
      let showDocs = this.config.enableFloat
      await this.floating.resolveItem(resolved.source, resolved.item, this.option, showDocs, detailRendered)
    }, null, this.disposables)
    this.nvim.call('coc#ui#check_pum_keymappings', [this.config.autoTrigger], true)
    commands.registerCommand('editor.action.triggerSuggest', async (source?: string) => {
      await this.startCompletion({ source })
    }, this, true)
  }

  public get mru(): MruLoader {
    return this._mru
  }

  public onCursorMovedI(bufnr: number, cursor: [number, number], hasInsert: boolean): void {
    if (hasInsert || !this.option || bufnr !== this.option.bufnr) return
    let { linenr, colnr, col } = this.option
    if (linenr === cursor[0]) {
      if (cursor[1] == colnr && cursor[1] === byteLength(toText(this.pretext)) + 1) {
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
        if (!this.inserted && text === this.pum.search) {
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
    return this.complete != null
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
  private loadLocalConfig(doc?: Document): void {
    let suggest = workspace.getConfiguration('suggest', doc)
    this.config = {
      autoTrigger: suggest.get<string>('autoTrigger', 'always'),
      insertMode: suggest.get<InsertMode>('insertMode', InsertMode.Repalce),
      filterGraceful: suggest.get<boolean>('filterGraceful', true),
      enableFloat: suggest.get<boolean>('enableFloat', true),
      languageSourcePriority: suggest.get<number>('languageSourcePriority', 99),
      snippetsSupport: suggest.get<boolean>('snippetsSupport', true),
      defaultSortMethod: suggest.get<SortMethod>('defaultSortMethod', SortMethod.Length),
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
    let suggest = workspace.initialConfiguration.get('suggest') as any
    let labels = defaultValue(suggest.completionItemKindLabels, {})
    this.staticConfig = Object.assign(this.staticConfig ?? {}, {
      kindMap: createKindMap(labels),
      defaultKindText: toText(labels['default']),
      detailField: suggest.detailField,
      detailMaxLength: toNumber(suggest.detailMaxLength, 100),
      invalidInsertCharacters: toArray(suggest.invalidInsertCharacters),
      formatItems: suggest.formatItems,
      filterOnBackspace: suggest.filterOnBackspace,
      floatConfig: toObject(suggest.floatConfig),
      pumFloatConfig: suggest.pumFloatConfig,
      labelMaxLength: suggest.labelMaxLength,
      reversePumAboveCursor: !!suggest.reversePumAboveCursor,
      snippetIndicator: toText(suggest.snippetIndicator),
      noselect: !!suggest.noselect,
      enablePreselect: !!suggest.enablePreselect,
      virtualText: !!suggest.virtualText,
      selection: suggest.selection
    })
    let doc = workspace.getDocument(workspace.bufnr)
    this.loadLocalConfig(doc)
  }

  public async startCompletion(opt?: { source?: string }): Promise<void> {
    clearTimeout(this.triggerTimer)
    let sourceList: ISource[]
    if (Is.string(opt.source)) {
      sourceList = toArray(sources.getSource(opt.source))
    }
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    let doc = workspace.getAttachedDocument(bufnr)
    let info = await this.nvim.call('coc#util#change_info') as InsertChange
    info.pre = byteSlice(info.line, 0, info.col - 1)
    const option = this.getCompleteOption(doc, info, true)
    await this._startCompletion(option, sourceList)
  }

  private async _startCompletion(option: CompleteOption, sourceList?: ISource[]): Promise<void> {
    this._debounced.clear()
    let doc = workspace.getAttachedDocument(option.bufnr)
    option.filetype = doc.filetype
    logger.debug('trigger completion with', option)
    this.stop(true)
    this.pretext = byteSlice(option.line, 0, option.colnr - 1)
    sourceList = sourceList ?? sources.getSources(option)
    if (isFalsyOrEmpty(sourceList)) return
    let complete = this.complete = new Complete(
      option,
      doc,
      this.config,
      sourceList)
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

  private async onTextChangedP(_bufnr: number, info: InsertChange): Promise<void> {
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
    const filterOnBackspace = this.staticConfig.filterOnBackspace
    if (option != null) {
      // detect item word insert
      if (!info.insertChar) {
        let pre = byteSlice(option.line, 0, option.col)
        if (this.selectedItem) {
          let { word, startcol } = this.popupEvent
          if (byteSlice(option.line, 0, startcol) + word == info.pre) {
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
      if (shouldStop(bufnr, info, option) || (filterOnBackspace === false && info.pre.length < this.pretext.length)) {
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
      let result = this.complete.resolveItem(resolvedItem)
      if (result && sources.shouldCommit(result.source, result.item, last)) {
        logger.debug('commit by commit character.')
        let startcol = byteIndex(this.option.line, resolvedItem.character) + 1
        this.stop(true)
        this.nvim.call('coc#pum#repalce', [startcol, resolvedItem.word + info.insertChar], true)
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
    if (this.config.autoTrigger === 'none') return []
    return sources.getTriggerSources(pretext, doc.filetype, doc.uri, disabled)
  }

  private async triggerCompletion(doc: Document, info: InsertChange, sources?: ISource[]): Promise<boolean> {
    let { minTriggerInputLength, autoTrigger } = this.config
    let { pre } = info
    // check trigger
    if (autoTrigger === 'none') return false
    if (!sources && !this.shouldTrigger(doc, pre)) return false
    const option = this.getCompleteOption(doc, info)
    if (sources == null && option.input.length < minTriggerInputLength) {
      logger.trace(`Suggest not triggered with input "${option.input}", minimal trigger input length: ${minTriggerInputLength}`)
      return false
    }
    if (checkIgnoreRegexps(this.config.ignoreRegexps, option.input)) return false
    await this._startCompletion(option, sources)
    return true
  }

  private getCompleteOption(doc: Document, info: InsertChange, manual = false): CompleteOption {
    let { pre } = info
    let input = getInput(doc.chars, info.pre, this.config.asciiCharactersOnly)
    let followWord = doc.getStartWord(info.line.slice(info.pre.length))
    return {
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
      triggerCharacter: manual ? undefined : toText(pre[pre.length - 1])
    }
  }

  public stop(close: boolean, kind: CompleteFinishKind = CompleteFinishKind.Normal): void {
    let { complete } = this
    if (complete == null) return
    let inserted = kind === CompleteFinishKind.Confirm || (this.popupEvent?.inserted && kind != CompleteFinishKind.Cancel)
    let item = this.selectedItem
    let character = item?.character
    let resolved = complete.resolveItem(item)
    let option = complete.option
    let input = complete.input
    let doc = workspace.getDocument(option.bufnr)
    let line = option.line
    let inputStart = characterIndex(line, option.col)
    events.completing = false
    this.cancel()
    doc._forceSync()
    void events.fire('CompleteDone', [toCompleteDoneItem(item, resolved?.item)])
    if (close) this.nvim.call('coc#pum#_close', [], true)
    if (resolved && inserted) {
      this._mru.add(line.slice(character, inputStart) + input, item)
    }
    if (kind == CompleteFinishKind.Confirm && resolved) {
      void this.confirmCompletion(resolved.source, resolved.item, option)
    }
  }

  private async confirmCompletion(source: ISource, item: CompleteItem, option: CompleteOption): Promise<void> {
    await this.floating.resolveItem(source, item, option, false)
    if (!Is.func(source.onCompleteDone)) return
    let { insertMode, snippetsSupport } = this.config
    let opt: CompleteDoneOption = Object.assign({ insertMode, snippetsSupport }, option)
    await Promise.resolve(source.onCompleteDone(item, opt))
  }

  private async onInsertEnter(bufnr: number): Promise<void> {
    if (!this.config.triggerAfterInsertEnter || this.config.autoTrigger !== 'always') return
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.attached) return
    let change = await this.nvim.call('coc#util#change_info') as InsertChange
    change.pre = byteSlice(change.line, 0, change.col - 1)
    await this.triggerCompletion(doc, change)
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
