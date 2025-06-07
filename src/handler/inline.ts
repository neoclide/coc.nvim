'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InlineCompletionTriggerKind, StringValue, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import completion from '../completion'
import { IConfigurationChangeEvent } from '../configuration/types'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import { defaultValue, disposeAll, waitWithToken } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { CancellationTokenSource, Disposable, InlineCompletionItem } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'
const logger = createLogger('handler-inline')

let ns: number
export const NAMESPACE = 'inlineSuggest'

export interface InlineSuggetOption {
  provider?: string
  autoTrigger?: boolean
}

export interface InlineSuggestConfig {
  autoTrigger: boolean
  triggerCompletionWait: number
}

export default class InlineCompletion {
  private tokenSource: CancellationTokenSource
  private _bufnr: number | undefined
  private _items: InlineCompletionItem[] | undefined
  private _index = 0
  private disposables: Disposable[] = []
  private config: InlineSuggestConfig
  private _notSupported

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this._notSupported = false
    if (workspace.isNvim && !workspace.has('nvim-0.10.0')) {
      this._notSupported = true
      this.config = { autoTrigger: false, triggerCompletionWait: 0 }
    } else {
      this.loadConfiguration()
      workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
      window.onDidChangeActiveTextEditor(() => {
        this.loadConfiguration()
      }, this, this.disposables)
      workspace.onDidChangeTextDocument(e => {
        if (!this.config.autoTrigger || languages.inlineCompletionItemManager.isEmpty) return
        if (e.bufnr !== window.activeTextEditor?.bufnr || !events.insertMode) return
        return this._trigger(e.bufnr, { autoTrigger: true }, this.config.triggerCompletionWait)
      }, null, this.disposables)
      events.on(['InsertCharPre', 'CursorMovedI', 'BufEnter', 'ModeChanged'], () => {
        this.cancel()
      }, null, this.disposables)
    }
    commands.titles.set('document.checkInlineCompletion', 'check inline completion state of current buffer')
    this.handler.addDisposable(commands.registerCommand('document.checkInlineCompletion', async () => {
      if (!this.supported) {
        return window.showWarningMessage(`Inline completion not supported, requires neovim >= 0.10.0`)
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
    if (!e || e.affectsConfiguration('hover')) {
      let doc = window.activeTextEditor?.document
      let config = workspace.getConfiguration('inlineSuggest', doc)
      let autoTrigger = defaultValue<boolean>(config.inspect('autoTrigger').globalValue as boolean, true)
      this.config = Object.assign(this.config ?? {}, {
        autoTrigger: !this._notSupported && autoTrigger,
        triggerCompletionWait: defaultValue(config.inspect('triggerCompletionWait').globalValue as number, 100)
      })
    }
  }

  public get supported(): boolean {
    return !this._notSupported
  }

  public get autoTrigger(): boolean {
    return this.config.autoTrigger
  }

  public get selected(): InlineCompletionItem | undefined {
    return defaultValue(this._items, [])[this._index]
  }

  public isSelected(): boolean {
    return this.selected != null
  }

  public hasProvider(bufnr: number): boolean {
    let doc = workspace.getAttachedDocument(bufnr)
    return doc && languages.hasProvider(ProviderName.InlineCompletion, doc.textDocument)
  }

  private get namespace(): Promise<number> {
    if (ns) return Promise.resolve(ns)
    return this.nvim.createNamespace(NAMESPACE).then(n => {
      ns = n
      return ns
    })
  }

  public async trigger(bufnr: number, option: InlineSuggetOption): Promise<void> {
    await this._trigger(bufnr, option)
  }

  private async _trigger(bufnr: number, option: InlineSuggetOption, delay?: number): Promise<void> {
    this.cancel()
    let document = workspace.getDocument(bufnr)
    if (!document || !document.attached || !this.supported) return
    if (!languages.hasProvider(ProviderName.InlineCompletion, document)) return
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    if (delay) await waitWithToken(delay, token)
    if (token.isCancellationRequested) return
    if (document.hasChanged) {
      await document.synchronize()
    }
    let state = await this.handler.getCurrentState()
    if (state.doc.bufnr !== bufnr || state.mode != 'i' || token.isCancellationRequested) return
    let items = await languages.provideInlineCompletionItems(document.textDocument, state.position, {
      provider: option.provider,
      selectedCompletionInfo: completion.selectedCompletionInfo,
      triggerKind: option.autoTrigger ? InlineCompletionTriggerKind.Automatic : InlineCompletionTriggerKind.Invoked
    }, token)
    if (isFalsyOrEmpty(items)) {
      if (!option.autoTrigger) {
        void window.showWarningMessage(`No inline completion items from provider.`)
      }
      return
    }
    this._bufnr = bufnr
    this._items = items
    this._index = 0
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
    this._items = undefined
    this._bufnr = undefined
  }

  public async accept(bufnr: number): Promise<void> {
    if (bufnr !== this._bufnr) return
    let item = this.selected
    if (!item) return
    this.cancel()
    let doc = workspace.getAttachedDocument(bufnr)
    doc.buffer.clearNamespace(NAMESPACE)
    let edit = TextEdit.replace(item.range, getInsertText(item))
    if (StringValue.isSnippet(item.insertText)) {
      await commands.executeCommand('editor.action.insertSnippet', edit)
    } else {
      await doc.applyEdits([edit])
    }
    if (item.command) {
      try {
        await commands.execute(item.command)
      } catch (err) {
        logger.error(`Error in execute command "${item.command.command}"`, err)
      }
    }
  }

  public async next(bufnr: number): Promise<void> {
    if (bufnr !== this._bufnr) return
    let item = toArray(this._items)[this._index + 1]
    if (item) await this.insertVtext(bufnr, item)
  }

  public async prev(bufnr: number): Promise<void> {
    if (bufnr !== this._bufnr) return
    let item = toArray(this._items)[this._index - 1]
    if (item) await this.insertVtext(bufnr, item)
  }

  private async insertVtext(bufnr: number, item: InlineCompletionItem): Promise<void> {
    let doc = workspace.getDocument(bufnr)
    let buffer = doc.buffer
    let text = getInsertText(item) + ` (${this._index + 1}/${this._items.length})`
    let ns = await this.namespace
    let pos = item.range.start
    // TODO check the range and text after, not insert unnecessary text.
    this.nvim.pauseNotification()
    this.nvim.call('coc#pum#clear_vtext', [], true)
    buffer.clearNamespace(NAMESPACE)
    buffer.setVirtualText(ns, pos.line, [[text, 'CocInlineVirtualText']], { col: pos.character })
    this.nvim.resumeNotification(true, true)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export function getInsertText(item: InlineCompletionItem): string {
  return StringValue.isSnippet(item.insertText) ? item.insertText.value : item.insertText
}
