'use strict'
import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions, InlineCompletionTriggerKind, Position, Range, StringValue, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import completion from '../completion'
import { IConfigurationChangeEvent } from '../configuration/types'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import { SnippetParser } from '../snippets/parser'
import { normalizeSnippetString } from '../snippets/util'
import { defaultValue, disposeAll, waitWithToken } from '../util'
import { toArray } from '../util/array'
import { onUnexpectedError } from '../util/errors'
import { emptyRange, getEnd } from '../util/position'
import { CancellationTokenSource, Disposable, InlineCompletionItem } from '../util/protocol'
import { byteIndex } from '../util/string'
import { reduceTextEdit } from '../util/textedit'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'
const logger = createLogger('handler-inline')

export const NAMESPACE = 'inlineSuggest'

export interface InlineSuggestOption {
  provider?: string
  autoTrigger?: boolean
}

export interface InlineSuggestConfig {
  autoTrigger: boolean
  triggerCompletionWait: number
}

export type AcceptKind = 'all' | 'word' | 'line'

export function getInsertText(item: InlineCompletionItem, formatOptions: FormattingOptions): string {
  if (StringValue.isSnippet(item.insertText)) {
    const parser = new SnippetParser(false)
    const snippet = parser.parse(item.insertText.value, true)
    return normalizeSnippetString(snippet.toString(), '', formatOptions)
  }
  return normalizeSnippetString(item.insertText, '', formatOptions)
}

export default class InlineCompletion {
  private _bufnr: number | undefined
  private _items: InlineCompletionItem[] = []
  private _index = 0
  private _cursor = Position.create(0, 0)
  private _vtext: string
  private tokenSource: CancellationTokenSource
  private disposables: Disposable[] = []
  private config: InlineSuggestConfig

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    window.onDidChangeActiveTextEditor(() => {
      this.loadConfiguration()
    }, this, this.disposables)
    let changedBufnr: number
    let changedTime: number
    events.on('TextChangedI', (bufnr, info) => {
      if (info.insertChar) {
        changedBufnr = bufnr
        changedTime = Date.now()
      }
    }, null, this.disposables)
    events.on('Enter', bufnr => {
      changedBufnr = bufnr
      changedTime = Date.now()
    }, null, this.disposables)
    workspace.onDidChangeTextDocument(e => {
      if (this.config.autoTrigger
        && !languages.inlineCompletionItemManager.isEmpty
        && changedBufnr == e.bufnr
        && Date.now() - changedTime < 200
        && e.bufnr === window.activeTextEditor?.bufnr
        && events.insertMode
      ) {
        const wait = this.config.triggerCompletionWait
        const option = { autoTrigger: true }
        this._trigger(e.bufnr, option, wait).catch(onUnexpectedError)
      }
    }, null, this.disposables)

    events.on(['InsertCharPre', 'CursorMovedI', 'BufEnter', 'ModeChanged'], () => {
      this.cancel()
    }, null, this.disposables)
    commands.titles.set('document.checkInlineCompletion', 'check inline completion state of current buffer')
    this.handler.addDisposable(commands.registerCommand('document.checkInlineCompletion', async () => {
      if (!this.supported) {
        return window.showWarningMessage(`Inline completion is not supported, requires neovim >= 0.10.0`)
      }
      if (!this.autoTrigger) {
        return window.showWarningMessage(`Inline completion auto trigger disabled by configuration "inlineSuggest.autoTrigger"`)
      }
      let bufnr = await this.nvim.eval('bufnr("%")') as number
      try {
        if (!this.hasProvider(bufnr)) {
          void window.showWarningMessage(`Inline completion provider not found for buffer ${bufnr}.`)
        }
      } catch (e) {
        void window.showWarningMessage((e as Error).message)
      }
    }))
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('inlineSuggest')) {
      let doc = window.activeTextEditor?.document
      let config = workspace.getConfiguration('inlineSuggest', doc)
      let autoTrigger = defaultValue<boolean>(config.inspect('autoTrigger').globalValue as boolean, true)
      this.config = Object.assign(this.config ?? {}, {
        autoTrigger,
        triggerCompletionWait: defaultValue(config.inspect('triggerCompletionWait').globalValue as number, 100)
      })
    }
  }

  public get supported(): boolean {
    return workspace.has('patch-9.0.0185') || workspace.has('nvim-0.7.0')
  }

  public get autoTrigger(): boolean {
    return this.config.autoTrigger
  }

  public get selected(): InlineCompletionItem | undefined {
    return this._items[this._index]
  }

  public isSelected(): boolean {
    return this.selected != null
  }

  public hasProvider(bufnr: number): boolean {
    let doc = workspace.getAttachedDocument(bufnr)
    return doc && languages.hasProvider(ProviderName.InlineCompletion, doc.textDocument)
  }

  public get namespace(): Promise<number> {
    return this.nvim.createNamespace(NAMESPACE)
  }

  public async visible(): Promise<boolean> {
    let result = await this.nvim.call('coc#inline#visible') as number
    return !!result
  }

  public async trigger(bufnr: number, option: InlineSuggestOption): Promise<void> {
    await this._trigger(bufnr, option)
  }

  private async _trigger(bufnr: number, option: InlineSuggestOption, delay?: number): Promise<void> {
    this.cancel()
    let document = workspace.getAttachedDocument(bufnr)
    if (!languages.hasProvider(ProviderName.InlineCompletion, document)) return
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    if (delay) await waitWithToken(delay, token)
    if (!option.autoTrigger && document.hasChanged) {
      await document.synchronize()
    }
    if (token.isCancellationRequested) return
    let state = await this.handler.getCurrentState()
    if (state.doc.bufnr !== bufnr || !state.mode.startsWith('i') || token.isCancellationRequested) return
    let items = await languages.provideInlineCompletionItems(document.textDocument, state.position, {
      provider: option.provider,
      selectedCompletionInfo: completion.selectedCompletionInfo,
      triggerKind: option.autoTrigger ? InlineCompletionTriggerKind.Automatic : InlineCompletionTriggerKind.Invoked
    }, token)
    if (token.isCancellationRequested) return
    this._items = toArray(items)
    this._cursor = state.position
    this._index = 0
    if (items.length === 0 && !option.autoTrigger) {
      void window.showWarningMessage(`No inline completion items from provider.`)
    }
    await this.insertVtext(bufnr, items[0])
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = undefined
    }
    if (this._bufnr) {
      this.nvim.createBuffer(this._bufnr).clearNamespace(NAMESPACE)
    }
    this._items = []
    this._bufnr = undefined
  }

  public async accept(bufnr: number, kind: AcceptKind = 'all'): Promise<void> {
    if (bufnr !== this._bufnr) return
    let item = this.selected
    if (!item) return
    this.cancel()
    let doc = workspace.getAttachedDocument(bufnr)
    let insertedLength = 0
    if (StringValue.isSnippet(item.insertText) && kind == 'all') {
      let range = item.range ? item.range : Range.create(this._cursor, this._cursor)
      let edit = [TextEdit.replace(range, item.insertText.value)]
      await commands.executeCommand('editor.action.insertSnippet', edit)
    } else {
      let insertedText = this._vtext
      let range: Range
      if (kind == 'word') {
        let total = 0
        for (let i = 1; i < insertedText.length; i++) {
          if (doc.isWord(insertedText[i])) {
            total = i
          } else {
            break
          }
        }
        insertedText = insertedText.slice(0, total + 1)
        insertedLength = insertedText.length
      } else if (kind == 'line') {
        // get the first line of insertedText
        const insertText = insertedText.split('\n')[0]
        insertedLength = insertText.length
      } else {
        insertedText = getInsertText(item, window.activeTextEditor.options)
        range = item.range
      }
      range = range ?? Range.create(this._cursor, this._cursor)
      const pos = getEnd(range.start, insertedText)
      await doc.applyEdits([TextEdit.replace(range, insertedText)], false, false)
      await window.moveTo(pos)
    }
    if (item.command) {
      try {
        await commands.execute(item.command)
      } catch (err) {
        logger.error(`Error on execute command "${item.command.command}"`, err)
      }
    }
    if (insertedLength) {
      await events.fire('InlineAccept', [insertedLength, item])
      // need trigger again?
      // this._trigger(bufnr, { autoTrigger: true }).catch(onUnexpectedError)
    }
  }

  public async next(bufnr: number): Promise<void> {
    if (bufnr !== this._bufnr) return
    let item = this._items[this._index + 1]
    if (item) {
      this._index += 1
      await this.insertVtext(bufnr, item)
    }
  }

  public async prev(bufnr: number): Promise<void> {
    if (bufnr !== this._bufnr) return
    let item = this._items[this._index - 1]
    if (item) {
      this._index -= 1
      await this.insertVtext(bufnr, item)
    }
  }

  public async insertVtext(bufnr: number, item: InlineCompletionItem | undefined): Promise<void> {
    if (!item) return
    let doc = workspace.getAttachedDocument(bufnr)
    let formatOptions = window.activeTextEditor.options
    let text = getInsertText(item, formatOptions)
    let pos = item.range ? item.range.start : this._cursor
    if (item.range && !emptyRange(item.range)) {
      // TODO need make start pos to be cursor pos
      let edit = TextEdit.replace(item.range, text)
      edit = reduceTextEdit(edit, doc.textDocument.getText(item.range))
      pos = edit.range.start
      text = edit.newText
    }
    const line = doc.getline(pos.line)
    const col = byteIndex(line, pos.character) + 1
    const extra = this._items.length > 1 ? ` (${this._index + 1}/${this._items.length})` : ''
    this._bufnr = bufnr
    this._vtext = text
    let shown = await this.nvim.call('coc#inline#_insert', [bufnr, pos.line, col, text + extra])
    if (shown) {
      this.nvim.redrawVim()
      void events.fire('InlineShown', [item])
    } else {
      this._bufnr = undefined
      this._items = []
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
