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
import { defaultValue, disposeAll, waitWithToken } from '../util'
import { toArray } from '../util/array'
import { onUnexpectedError } from '../util/errors'
import { comparePosition, emptyRange, getEnd, positionInRange } from '../util/position'
import { CancellationTokenSource, Disposable, InlineCompletionItem } from '../util/protocol'
import { byteIndex, toText } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'
const logger = createLogger('handler-inline')

const NAMESPACE = 'inlineSuggest'

export interface InlineSuggestOption {
  provider?: string
  autoTrigger?: boolean
}

export interface InlineSuggestConfig {
  autoTrigger: boolean
  triggerCompletionWait: number
}

export type AcceptKind = 'all' | 'word' | 'line'

export function formatInsertText(text: string, opts: FormattingOptions): string {
  let lines = text.split(/\r?\n/)
  let tabSize = defaultValue(opts.tabSize, 2)
  let ind = opts.insertSpaces ? ' '.repeat(opts.tabSize) : '\t'
  lines = lines.map(line => {
    let space = line.match(/^\s*/)[0]
    let isTab = space.startsWith('\t')
    let len = space.length
    if (isTab && opts.insertSpaces) {
      space = ind.repeat(space.length)
    } else if (!isTab && !opts.insertSpaces) {
      space = ind.repeat(space.length / tabSize)
    }
    return space + line.slice(len)
  })
  return lines.join('\n')
}

export function getInsertText(item: InlineCompletionItem, formatOptions: FormattingOptions): string {
  if (StringValue.isSnippet(item.insertText)) {
    const parser = new SnippetParser(false)
    const snippet = parser.parse(item.insertText.value, true)
    return formatInsertText(snippet.toString(), formatOptions)
  }
  return formatInsertText(item.insertText, formatOptions)
}

export class InlineSesion {
  constructor(
    public readonly bufnr: number,
    public readonly cursor: Position,
    public readonly items: InlineCompletionItem[],
    public index = 0,
    public vtext: string | undefined = undefined
  ) {
  }

  public get length(): number {
    return this.items.length
  }

  public get selected(): InlineCompletionItem | undefined {
    return this.items[this.index]
  }

  public clearNamespace(): void {
    if (this.vtext) {
      workspace.nvim.createBuffer(this.bufnr).clearNamespace(NAMESPACE)
      this.vtext = undefined
    }
  }

  public get extra(): string {
    return this.length > 1 ? ` (${this.index + 1}/${this.length})` : ''
  }

  public get nextIndex(): number {
    return this.index === this.length - 1 ? 0 : this.index + 1
  }

  public get prevIndex(): number {
    return this.index === 0 ? this.length - 1 : this.index - 1
  }
}

export default class InlineCompletion {
  public session: InlineSesion | undefined
  private tokenSource: CancellationTokenSource
  private disposables: Disposable[] = []
  private config: InlineSuggestConfig

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    window.onDidChangeActiveTextEditor(() => {
      this.loadConfiguration()
    }, this, this.disposables)
    workspace.onDidChangeTextDocument(e => {
      if (languages.inlineCompletionItemManager.isEmpty === false
        && this.config.autoTrigger
        && e.bufnr === defaultValue(window.activeTextEditor, {} as any).bufnr
        && events.insertMode
      ) {
        const wait = this.config.triggerCompletionWait
        const option = { autoTrigger: true }
        this.trigger(e.bufnr, option, wait).catch(onUnexpectedError)
      }
    }, null, this.disposables)

    events.on(['InsertCharPre', 'CursorMovedI', 'ModeChanged'], () => {
      this.cancel()
    }, null, this.disposables)
    workspace.onDidCloseTextDocument(e => {
      if (e.bufnr === this.session?.bufnr) {
        this.cancel()
      }
    }, null, this.disposables)

    commands.titles.set('document.checkInlineCompletion', 'check inline completion state of current buffer')
    this.handler.addDisposable(commands.registerCommand('document.checkInlineCompletion', async () => {
      if (!this.supported) {
        void window.showWarningMessage(`Inline completion is not supported on current vim ${workspace.env.version}`)
        return
      }
      let bufnr = await this.nvim.eval('bufnr("%")') as number
      let doc = workspace.getDocument(bufnr)
      if (!doc || !doc.attached) {
        void window.showWarningMessage(`Buffer ${bufnr} is not attached, see ':h coc-document-attached'.`)
        return
      }
      let providers = languages.inlineCompletionItemManager.getProviders(doc.textDocument)
      if (providers.length === 0) {
        void window.showWarningMessage(`Inline completion provider not found for buffer ${bufnr}.`)
        return
      }
      let names = providers.map(item => item.provider['__extensionName'] ?? 'unknown')
      void window.showInformationMessage(`Inline completion is supported by ${names.join(', ')}.`)
    }))
  }

  private loadConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('inlineSuggest')) {
      let doc = defaultValue<any>(window.activeTextEditor, {}).document
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

  public get selected(): InlineCompletionItem | undefined {
    return this.session?.selected
  }

  public async visible(): Promise<boolean> {
    let result = await this.nvim.call('coc#inline#visible') as number
    return !!result
  }

  public get vtextBufnr(): number {
    return this.session?.vtext == null ? -1 : this.session.bufnr
  }

  public async trigger(bufnr: number, option?: InlineSuggestOption, delay?: number): Promise<boolean> {
    if (!this.supported) return false
    this.cancel()
    option = option ?? {}
    let document = workspace.getAttachedDocument(bufnr)
    if (!languages.hasProvider(ProviderName.InlineCompletion, document)) return false
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    if (delay) await waitWithToken(delay, token)
    if (option.autoTrigger !== true && document.hasChanged) {
      await document.synchronize()
    }
    if (token.isCancellationRequested) return false
    let state = await this.handler.getCurrentState()
    if (state.doc.bufnr !== bufnr || !state.mode.startsWith('i') || token.isCancellationRequested) return false
    let position = state.position
    let items = await languages.provideInlineCompletionItems(document.textDocument, state.position, {
      provider: option.provider,
      selectedCompletionInfo: completion.selectedCompletionInfo,
      triggerKind: option.autoTrigger ? InlineCompletionTriggerKind.Automatic : InlineCompletionTriggerKind.Invoked
    }, token)
    if (token.isCancellationRequested) return false
    items = toArray(items).filter(item => {
      if (item.range) return positionInRange(position, item.range) === 0
      return true
    })
    if (items.length === 0) {
      if (!option.autoTrigger) {
        void window.showWarningMessage(`No inline completion items from provider.`)
      }
      return false
    }
    this.session = new InlineSesion(bufnr, position, items)
    await this.insertVtext(items[0])
    return true
  }

  public async accept(bufnr: number, kind: AcceptKind = 'all'): Promise<boolean> {
    if (bufnr !== this.vtextBufnr || !this.selected) return false
    let item = this.selected
    let cursor = this.session.cursor
    let insertedText = this.session.vtext
    this.cancel()
    let doc = workspace.getAttachedDocument(bufnr)
    let insertedLength = 0
    if (StringValue.isSnippet(item.insertText) && kind == 'all') {
      let range = defaultValue(item.range, Range.create(cursor, cursor))
      let edit = TextEdit.replace(range, item.insertText.value)
      await commands.executeCommand('editor.action.insertSnippet', edit)
    } else {
      let range = Range.create(cursor, cursor)
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
        if (item.range) range = item.range
      }
      await doc.applyEdits([TextEdit.replace(range, insertedText)], false, false)
      await window.moveTo(getEnd(range.start, insertedText))
    }
    if (item.command) {
      try {
        await commands.execute(item.command)
      } catch (err) {
        logger.error(`Error on execute command "${item.command.command}"`, err)
      }
    }
    await events.fire('InlineAccept', [insertedLength, item])
    return true
  }

  public async next(bufnr: number): Promise<void> {
    await this._navigate(true, bufnr)
  }

  public async prev(bufnr: number): Promise<void> {
    await this._navigate(false, bufnr)
  }

  private async _navigate(next: boolean, bufnr: number): Promise<void> {
    if (bufnr !== this.vtextBufnr || this.session.length <= 1) return
    let idx = next ? this.session.nextIndex : this.session.prevIndex
    this.session.index = idx
    await this.insertVtext(this.session.selected)
  }

  public async insertVtext(item: InlineCompletionItem): Promise<void> {
    if (!this.session || !item) return
    const { bufnr, extra, cursor } = this.session
    let textDocument = workspace.getAttachedDocument(bufnr).textDocument
    let formatOptions = window.activeTextEditor.options
    let text = getInsertText(item, formatOptions)
    if (item.range && !emptyRange(item.range)) {
      let current = textDocument.getText(Range.create(item.range.start, cursor))
      text = text.slice(current.length)
      if (comparePosition(cursor, item.range.end) !== 0) {
        let after = textDocument.getText(Range.create(cursor, item.range.end))
        if (text.endsWith(after)) {
          text = text.slice(0, -after.length)
        }
      }
    }
    const line = toText(textDocument.lines[cursor.line])
    const col = byteIndex(line, cursor.character) + 1
    let shown = await this.nvim.call('coc#inline#_insert', [bufnr, cursor.line, col, (text + extra).split('\n')])
    if (shown) {
      this.session.vtext = text
      this.nvim.redrawVim()
      void events.fire('InlineShown', [item])
    } else if (this.session) {
      this.session.clearNamespace()
      this.session = undefined
    }
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = undefined
    }
    if (this.session) {
      this.session.clearNamespace()
      this.session = undefined
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
