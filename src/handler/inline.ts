'use strict'
import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions, InlineCompletionTriggerKind, Position, Range, StringValue, TextEdit } from 'vscode-languageserver-types'
import commands from '../commands'
import completion from '../completion'
import { IConfigurationChangeEvent } from '../configuration/types'
import events from '../events'
import languages, { ProviderName } from '../languages'
import { createLogger } from '../logger'
import Document from '../model/document'
import { SnippetParser } from '../snippets/parser'
import { defaultValue, disposeAll, waitWithToken } from '../util'
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
  silent?: boolean
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

export function getInserted(curr: string, synced: string, character: number): { start: number, text: string } | undefined {
  if (curr.length < synced.length) return undefined
  let after = curr.slice(character)
  if (!synced.endsWith(after)) return undefined
  let start = synced.length - after.length
  if (!curr.startsWith(synced.slice(0, start))) return undefined
  return { start, text: curr.slice(start, character) }
}

export function getPumInserted(document: Document, cursor: Position): string | undefined {
  const { line, character } = cursor
  let synced = toText(document.textDocument.lines[line])
  let curr = document.getline(cursor.line)
  if (synced === curr) return ''
  let change = getInserted(curr, synced, character)
  return change ? change.text : undefined
}

export function checkInsertedAtBeginning(currentLine: string, triggerCharacter: number, inserted: string, item: InlineCompletionItem): boolean {
  if (!item.range) {
    // check if inserted string is at the beginning item's insertText
    if (StringValue.isSnippet(item.insertText)) {
      return item.insertText.value.startsWith(inserted)
    }
    return item.insertText.startsWith(inserted)
  }
  // check if inserted string is at the beginning of item's range
  let current = currentLine.slice(item.range.start.character, triggerCharacter + inserted.length)
  if (StringValue.isSnippet(item.insertText)) {
    return item.insertText.value.startsWith(current)
  }
  return item.insertText.startsWith(current)
}

function fixRange(range: Range | undefined, inserted: string | undefined): Range | undefined {
  if (!inserted || !range) return range
  return Range.create(range.start, Position.create(range.end.line, range.end.character + inserted.length))
}

export class InlineSession {
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
    return this.length > 1 ? `(${this.index + 1}/${this.length})` : ''
  }

  public get nextIndex(): number {
    return this.index === this.length - 1 ? 0 : this.index + 1
  }

  public get prevIndex(): number {
    return this.index === 0 ? this.length - 1 : this.index - 1
  }
}

export default class InlineCompletion {
  public session: InlineSession | undefined
  private bufnr: number
  private tokenSource: CancellationTokenSource
  private disposables: Disposable[] = []
  private config: InlineSuggestConfig
  private _applying = false
  private _inserted: string | undefined

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    window.onDidChangeActiveTextEditor(() => {
      this.loadConfiguration()
    }, this, this.disposables)
    const triggerOption = { autoTrigger: true }
    workspace.onDidChangeTextDocument(e => {
      if (languages.inlineCompletionItemManager.isEmpty === false
        && this.config.autoTrigger
        && e.bufnr === defaultValue(window.activeTextEditor, {} as any).bufnr
        && !this._applying
        && events.insertMode
      ) {
        const wait = this.config.triggerCompletionWait
        this.trigger(e.bufnr, triggerOption, wait).catch(onUnexpectedError)
      }
    }, null, this.disposables)
    events.on('TextChangedI', bufnr => {
      // Try trigger on pum navigate.
      if (events.pumInserted && !languages.inlineCompletionItemManager.isEmpty) {
        const wait = this.config.triggerCompletionWait
        this.trigger(bufnr, triggerOption, wait).catch(onUnexpectedError)
      }
    }, null, this.disposables)
    events.on('ModeChanged', ev => {
      if (!ev.new_mode.startsWith('i')) {
        this.cancel()
      }
    }, null, this.disposables)
    events.on('InsertCharPre', () => {
      this.cancel()
    }, null, this.disposables)
    events.on('LinesChanged', bufnr => {
      if (bufnr === this.bufnr) {
        this.cancel()
      }
    }, null, this.disposables)
    workspace.onDidCloseTextDocument(e => {
      if (e.bufnr === this.bufnr) {
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
      let disable = await nvim.createBuffer(bufnr).getVar('coc_inline_disable') as number
      if (disable == 1) {
        void window.showWarningMessage(`Trigger inline completion is disabled by b:coc_inline_disable.`)
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
        triggerCompletionWait: defaultValue(config.inspect('triggerCompletionWait').globalValue as number, 10)
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
    let document = workspace.getDocument(bufnr)
    if (!document
      || !document.attached
      || !languages.hasProvider(ProviderName.InlineCompletion, document)) return false
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    this.bufnr = bufnr
    this._inserted = undefined
    let token = tokenSource.token
    if (delay) await waitWithToken(delay, token)
    if (option.autoTrigger !== true && document.hasChanged) {
      this._applying = true
      await document.synchronize()
      this._applying = false
    }
    if (token.isCancellationRequested) return false
    let state = await this.handler.getCurrentState()
    let disable = await document.buffer.getVar('coc_inline_disable') as number
    if (disable == 1
      || state.doc.bufnr !== bufnr
      || !state.mode.startsWith('i')
      || token.isCancellationRequested) return false
    let cursor = state.position
    let triggerPosition = cursor
    let curr = document.getline(cursor.line)
    if (option.autoTrigger) {
      let inserted = this._inserted = getPumInserted(document, cursor)
      if (inserted == null) return false
      triggerPosition = Position.create(cursor.line, cursor.character - inserted.length)
    }
    const selectedCompletionInfo = completion.selectedCompletionInfo
    if (selectedCompletionInfo && this._inserted) selectedCompletionInfo.range.end.character -= this._inserted.length
    let items = await languages.provideInlineCompletionItems(document.textDocument, triggerPosition, {
      provider: option.provider,
      selectedCompletionInfo,
      triggerKind: option.autoTrigger ? InlineCompletionTriggerKind.Automatic : InlineCompletionTriggerKind.Invoked
    }, token)
    this.tokenSource = undefined
    if (!Array.isArray(items) || token.isCancellationRequested) return false
    items = items.filter(item => !item.range || positionInRange(triggerPosition, item.range) === 0)
    // Inserted by pum navigate
    if (this._inserted) items = items.filter(item => checkInsertedAtBeginning(curr, triggerPosition.character, this._inserted, item))
    if (items.length === 0) {
      if (!option.autoTrigger && !option.silent) {
        void window.showWarningMessage(`No inline completion items from provider.`)
      }
      return false
    }
    this.session = new InlineSession(bufnr, cursor, items)
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
    const itemRange = fixRange(item.range, this._inserted)
    if (StringValue.isSnippet(item.insertText) && kind == 'all') {
      let range = defaultValue(itemRange, Range.create(cursor, cursor))
      let text = item.insertText.value
      if (!itemRange && this._inserted) text = text.slice(this._inserted.length)
      let edit = TextEdit.replace(range, text)
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
        if (itemRange) {
          range = itemRange
        } else if (this._inserted) {
          insertedText = insertedText.slice(this._inserted.length)
        }
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
    let doc = workspace.getDocument(bufnr)
    let formatOptions = window.activeTextEditor.options
    let text = getInsertText(item, formatOptions)
    const line = doc.getline(cursor.line)
    const itemRange = fixRange(item.range, this._inserted)
    if (itemRange && !emptyRange(itemRange)) {
      let current = line.slice(itemRange.start.character, cursor.character)
      text = text.slice(current.length)
      if (comparePosition(cursor, itemRange.end) !== 0) {
        let after = line.slice(cursor.character, itemRange.end.character)
        if (text.endsWith(after)) {
          text = text.slice(0, -after.length)
        }
      }
    } else if (this._inserted) {
      text = text.slice(this._inserted.length)
    }
    const col = byteIndex(line, cursor.character) + 1
    let shown = await this.nvim.call('coc#inline#_insert', [bufnr, cursor.line, col, text.split('\n'), extra])
    if (!this.session) return
    if (shown) {
      this.session.vtext = text
      this.nvim.redrawVim()
      void events.fire('InlineShown', [item])
    } else {
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
    this.bufnr = undefined
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
