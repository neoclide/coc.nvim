'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position, Range, StringValue, TextEdit } from 'vscode-languageserver-types'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import { LinesTextDocument } from '../model/textdocument'
import { DidChangeTextDocumentParams, JumpInfo, TextDocumentContentChange, UltiSnippetOption } from '../types'
import { defaultValue, waitNextTick } from '../util'
import { getTextEdit } from '../util/diff'
import { onUnexpectedError } from '../util/errors'
import { omit } from '../util/lodash'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
import { comparePosition, emptyRange, getEnd, positionInRange, rangeInRange } from '../util/position'
import { CancellationTokenSource, Emitter, Event } from '../util/protocol'
import { byteIndex } from '../util/string'
import { filterSortEdits, reduceTextEdit } from '../util/textedit'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode, generateContextId, getInitialPythonCode } from './eval'
import { getPlaceholderId, Placeholder, Text, TextmateSnippet } from './parser'
import { CocSnippet, CocSnippetPlaceholder, getNextPlaceholder, getUltiSnipActionCodes } from "./snippet"
import { SnippetString } from './string'
import { toSnippetString, UltiSnippetContext, wordsSource } from './util'
import { SnippetVariableResolver } from "./variableResolve"
const logger = createLogger('snippets-session')
const NAME_SPACE = 'snippets'

interface DocumentChange {
  version: number
  change: TextDocumentContentChange
}

export interface SnippetEdit {
  range: Range
  snippet: string | SnippetString | StringValue
}

export interface SnippetConfig {
  readonly highlight: boolean
  readonly nextOnDelete: boolean
  readonly preferComplete: boolean
}

export class SnippetSession {
  public mutex = new Mutex()
  private current: Placeholder
  private textDocument: LinesTextDocument
  private tokenSource: CancellationTokenSource
  private _applying = false
  private _paused = false
  public snippet: CocSnippet = null
  private _onActiveChange = new Emitter<boolean>()
  private _selected = false
  public readonly onActiveChange: Event<boolean> = this._onActiveChange.event

  constructor(
    private nvim: Neovim,
    public readonly document: Document,
    private readonly config: SnippetConfig
  ) {
  }

  public get selected(): boolean {
    return this._selected
  }

  public async insertSnippetEdits(edits: SnippetEdit[]): Promise<boolean> {
    if (edits.length === 0) return this.isActive
    if (edits.length === 1) return await this.start(toSnippetString(edits[0].snippet), edits[0].range, false)
    const textDocument = this.document.textDocument
    const textEdits = filterSortEdits(textDocument, edits.map(e => TextEdit.replace(e.range, toSnippetString(e.snippet))))
    const len = textEdits.length
    const snip = new TextmateSnippet()
    for (let i = 0; i < len; i++) {
      let range = textEdits[i].range
      let placeholder = new Placeholder(i + 1)
      placeholder.appendChild(new Text(textDocument.getText(range)))
      snip.appendChild(placeholder)
      if (i != len - 1) {
        let r = Range.create(range.end, textEdits[i + 1].range.start)
        snip.appendChild(new Text(textDocument.getText(r)))
      }
    }
    this.deactivate()
    const resolver = new SnippetVariableResolver(this.nvim, workspace.workspaceFolderControl)
    let snippet = new CocSnippet(snip, textEdits[0].range.start, this.nvim, resolver)
    await snippet.init()
    this.activate(snippet)
    // reverse insert needed
    for (let i = len - 1; i >= 0; i--) {
      let idx = i + 1
      this.current = snip.placeholders.find(o => o.index === idx)
      let edit = textEdits[i]
      await this.start(edit.newText, edit.range, false)
    }
    return this.isActive
  }

  public async start(inserted: string, range: Range, select = true, context?: UltiSnippetContext): Promise<boolean> {
    let { document, snippet } = this
    this._paused = false
    const edits: TextEdit[] = []
    let textmateSnippet: TextmateSnippet
    if (inserted.length === 0) return this.isActive
    if (snippet && rangeInRange(range, snippet.range)) {
      // update all snippet.
      let oldRange = snippet.range
      let previous = snippet.text
      textmateSnippet = await this.snippet.replaceWithSnippet(range, inserted, this.current, context)
      let edit = reduceTextEdit({
        range: oldRange,
        newText: this.snippet.text
      }, previous)
      edits.push(edit)
    } else {
      this.deactivate()
      const resolver = new SnippetVariableResolver(this.nvim, workspace.workspaceFolderControl)
      snippet = new CocSnippet(inserted, range.start, this.nvim, resolver)
      await snippet.init(context)
      textmateSnippet = snippet.tmSnippet
      edits.push(TextEdit.replace(range, snippet.text))
      // try fix indent of text after snippet when insert new line
      if (inserted.replace(/\$0$/, '').endsWith('\n')) {
        const currentLine = document.getline(range.start.line)
        const remain = currentLine.slice(range.end.character)
        if (remain.length) {
          let s = range.end.character
          let l = remain.match(/^\s*/)[0].length
          let r = Range.create(range.end.line, s, range.end.line, s + l)
          edits.push(TextEdit.replace(r, currentLine.match(/^\s*/)[0]))
        }
      }
    }
    this.current = textmateSnippet.first
    this.nvim.call('coc#compat#del_var', ['coc_selected_text'], true)
    await this.applyEdits(edits)
    this.activate(snippet)
    // Not delay, avoid unexpected character insert
    if (context) await this.tryPostExpand(textmateSnippet)
    let { placeholder } = this
    if (select && placeholder) await this.selectPlaceholder(placeholder, true)
    return this.isActive
  }

  private async tryPostExpand(textmateSnippet: TextmateSnippet): Promise<void> {
    let result = getUltiSnipActionCodes(textmateSnippet, 'postExpand')
    if (!result) return
    const { start, end } = this.snippet.range
    const [code, resetCodes] = result
    let pos = `[${start.line},${start.character},${end.line},${end.character}]`
    let codes = [...resetCodes, `snip = coc_ultisnips_dict["PostExpandContext"](${pos})`, code]
    this.cancel()
    await executePythonCode(this.nvim, codes)
    await this.forceSynchronize()
  }

  private async tryPostJump(code: string, resetCodes: string[], info: JumpInfo, bufnr: number): Promise<void> {
    // make events.requesting = false
    await waitNextTick()
    this.nvim.setVar('coc_ultisnips_tabstops', info.tabstops, true)
    const { snippet_start, snippet_end } = info
    let pos = `[${snippet_start.line},${snippet_start.character},${snippet_end.line},${snippet_end.character}]`
    let codes = [...resetCodes, `snip = coc_ultisnips_dict["PostJumpContext"](${pos},${info.index},${info.forward ? 1 : 0})`, code]
    this.cancel()
    await executePythonCode(this.nvim, codes)
    await this.forceSynchronize()
    void events.fire('PlaceholderJump', [bufnr, info])
  }

  public async removeWhiteSpaceBefore(placeholder: CocSnippetPlaceholder): Promise<void> {
    if (!emptyRange(placeholder.range)) return
    let pos = placeholder.range.start
    let line = this.document.getline(pos.line)
    let ms = line.match(/\s+$/)
    if (ms && line.length === pos.character) {
      let startCharacter = pos.character - ms[0].length
      let textEdit = TextEdit.del(Range.create(pos.line, startCharacter, pos.line, pos.character))
      await this.document.applyEdits([textEdit])
      await this.forceSynchronize()
    }
  }

  private async applyEdits(edits: TextEdit[], joinundo = false): Promise<void> {
    let { document } = this
    this._applying = true
    await document.applyEdits(edits, joinundo)
    this._applying = false
    this.textDocument = document.textDocument
  }

  public async nextPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    if (!this.current) return
    let marker = this.current
    if (this.snippet.getUltiSnipOption(marker, 'removeWhiteSpace')) {
      let { placeholder } = this
      if (placeholder) await this.removeWhiteSpaceBefore(placeholder)
    }
    const p = this.snippet.getPlaceholderOnJump(marker, true)
    await this.selectPlaceholder(p, true)
  }

  public async previousPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    if (!this.current) return
    const p = this.snippet.getPlaceholderOnJump(this.current, false)
    await this.selectPlaceholder(p, true, false)
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    await this.forceSynchronize()
    let { placeholder } = this
    if (placeholder) await this.selectPlaceholder(placeholder, triggerAutocmd)
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder | undefined, triggerAutocmd = true, forward = true): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    this._selected = true
    let { start, end } = placeholder.range
    const line = document.getline(start.line)
    const marker = this.current = placeholder.marker
    const range = this.snippet.getSnippetRange(marker)
    const tabstops = this.snippet.getSnippetTabstops(marker)
    if (marker instanceof Placeholder && marker.choice && marker.choice.options.length) {
      const col = byteIndex(line, start.character) + 1
      wordsSource.words = marker.choice.options.map(o => o.value)
      wordsSource.startcol = col - 1
      // pum not work when use request during request.
      nvim.call('coc#snippet#show_choices', [start.line + 1, col, end, placeholder.value], true)
    } else {
      await this.select(placeholder)
      this.highlights()
    }
    if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
    let info: JumpInfo = {
      forward,
      tabstops,
      snippet_start: range.start,
      snippet_end: range.end,
      index: placeholder.index,
      range: placeholder.range,
      charbefore: start.character == 0 ? '' : line.slice(start.character - 1, start.character)
    }
    let result = getUltiSnipActionCodes(marker, 'postJump')
    if (result) {
      this.tryPostJump(result[0], result[1], info, document.bufnr).catch(onUnexpectedError)
    } else {
      void events.fire('PlaceholderJump', [document.bufnr, info])
    }
    this.checkFinalPlaceholder()
  }

  public checkFinalPlaceholder(): void {
    let current = this.current
    if (current && current.index === 0) {
      const { snippet } = current
      if (snippet === this.snippet.tmSnippet) {
        logger.info('Jump to final placeholder, cancelling snippet session')
        this.deactivate()
      } else {
        let marker = snippet.parent
        this.snippet.deactivateSnippet(snippet)
        if (marker instanceof Placeholder) {
          this.current = marker
        }
      }
    }
  }

  private highlights(): void {
    let { current, config } = this
    if (!current || !config.highlight || events.bufnr !== this.bufnr) return
    let buf = this.document.buffer
    this.nvim.pauseNotification()
    buf.clearNamespace(NAME_SPACE)
    let ranges = this.snippet.getRanges(current)
    buf.highlightRanges(NAME_SPACE, 'CocSnippetVisual', ranges)
    this.nvim.resumeNotification(true, true)
  }

  private async select(placeholder: CocSnippetPlaceholder): Promise<void> {
    let { range, value } = placeholder
    let { nvim } = this
    if (value.length > 0) {
      await nvim.call('coc#snippet#select', [range.start, range.end, value])
    } else {
      await nvim.call('coc#snippet#move', [range.start])
    }
    nvim.redrawVim()
  }

  public async checkPosition(): Promise<void> {
    if (!this.isActive) return
    let position = await window.getCursorPosition()
    if (this.snippet && positionInRange(position, this.snippet.range) != 0) {
      logger.info('Cursor insert out of range, cancelling snippet session')
      this.deactivate()
    }
  }

  public onTextChange(): void {
    this.cancel()
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (this._applying || !this.isActive || this._paused) return
    let changes = e.contentChanges
    // if not cancel, applyEdits would change latest document lines, which could be wrong.
    this.cancel()
    this.synchronize({ version: e.textDocument.version, change: changes[0] }).catch(onUnexpectedError)
  }

  public async synchronize(change?: DocumentChange): Promise<void> {
    const { document, isActive } = this
    this._paused = false
    if (!isActive) return
    await this.mutex.use(() => {
      if (!document.attached
        || document.dirty
        || !this.snippet
        || !this.textDocument
        || document.version === this.version) return Promise.resolve()
      if (change && (change.version - this.version !== 1 || document.version != change.version)) {
        // can't be used any more
        change = undefined
      }
      return this._synchronize(change)
    })
  }

  public async _synchronize(documentChange?: DocumentChange): Promise<void> {
    let { document, textDocument, current, snippet } = this
    const newDocument = document.textDocument
    if (equals(textDocument.lines, newDocument.lines)) {
      this.textDocument = newDocument
      return
    }
    const startTs = Date.now()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    const cursor = events.bufnr == document.bufnr ? await window.getCursorPosition() : undefined
    if (tokenSource.token.isCancellationRequested) return
    let change = documentChange?.change
    if (!change) {
      let edit = getTextEdit(textDocument.lines, newDocument.lines, cursor, events.insertMode)
      change = { range: edit.range, text: edit.newText }
    }
    const { range, start } = snippet
    let c = comparePosition(change.range.start, range.end)
    // consider insert at the end
    let insertEnd = emptyRange(change.range) && snippet.hasEndPlaceholder
    // change after snippet, do nothing
    if (c > 0 || (c === 0 && !insertEnd)) {
      logger.info('Content change after snippet')
      this.textDocument = newDocument
      return
    }
    // consider insert at the beginning, exclude new lines before.
    c = comparePosition(change.range.end, range.start)
    let insertBeginning = emptyRange(change.range)
      && !change.text.endsWith('\n')
      && snippet.hasBeginningPlaceholder
    if (c < 0 || (c === 0 && !insertBeginning)) {
      // change before beginning, reset position
      let changeEnd = change.range.end
      let checkCharacter = range.start.line === changeEnd.line
      let newLines = change.text.split(/\n/)
      let lc = newLines.length - (changeEnd.line - change.range.start.line + 1)
      let cc = 0
      if (checkCharacter) {
        if (newLines.length > 1) {
          cc = newLines[newLines.length - 1].length - changeEnd.character
        } else {
          cc = change.range.start.character + change.text.length - changeEnd.character
        }
      }
      this.snippet.resetStartPosition(Position.create(start.line + lc, start.character + cc))
      this.textDocument = newDocument
      logger.info('Content change before snippet, reset snippet position')
      return
    }
    if (!rangeInRange(change.range, range)) {
      logger.info('Before and snippet body changed, cancel snippet session')
      this.deactivate()
      return
    }
    const nextPlaceholder = getNextPlaceholder(current, true)
    const id = getPlaceholderId(current)
    const res = await this.snippet.replaceWithText(change.range, change.text, tokenSource.token, current, cursor)
    this.tokenSource = undefined
    if (!res) {
      if (this.snippet) {
        // find out the cloned placeholder
        let marker = this.snippet.getPlaceholderById(id, current.index)
        // the current could be invalid, so not able to find a cloned placeholder.
        this.current = defaultValue(marker, this.snippet.tmSnippet.first)
      }
      return
    }
    this.textDocument = newDocument
    let { snippetText, delta } = res
    let changedRange = Range.create(start, getEnd(start, snippetText))
    // check if snippet not changed as expected
    const expected = newDocument.getText(changedRange)
    if (expected !== snippetText) {
      logger.error(`Something went wrong with the snippet implementation`, change, snippetText, expected)
      this.deactivate()
      return
    }
    let newText = this.snippet.text
    // further update caused by related placeholders or python CodeBlock change
    if (newText !== snippetText) {
      let edit = reduceTextEdit({ range: changedRange, newText }, snippetText)
      await this.applyEdits([edit], true)
      if (delta) {
        this.nvim.call(`coc#cursor#move_to`, [cursor.line + delta.line, cursor.character + delta.character], true)
      }
    }
    this.highlights()
    logger.debug('update cost:', Date.now() - startTs, res.delta)
    this.trySelectNextOnDelete(current, nextPlaceholder).catch(onUnexpectedError)
    return
  }

  public async trySelectNextOnDelete(curr: Placeholder, next: Placeholder | undefined): Promise<void> {
    if (!this.config.nextOnDelete
      || !this.snippet
      || !curr
      || (curr.snippet != null && curr.toString() != '')
      || !next
    ) return
    let p = this.snippet.getPlaceholderByMarker(next)
    // the placeholder could be removed
    if (p) await this.selectPlaceholder(p, true)
  }

  public async forceSynchronize(): Promise<void> {
    if (this.isActive) {
      this._paused = false
      await this.document.patchChange()
      await this.synchronize()
    } else {
      await this.document.patchChange()
    }
  }

  public async onCompleteDone(): Promise<void> {
    if (this.isActive) {
      this._paused = false
      this.document._forceSync()
      await this.synchronize()
    }
  }

  public get version(): number {
    return this.textDocument ? this.textDocument.version : -1
  }

  public get isActive(): boolean {
    return this.snippet != null
  }

  public get bufnr(): number {
    return this.document.bufnr
  }

  private activate(snippet: CocSnippet): void {
    if (this.isActive) return
    this.snippet = snippet
    this.nvim.call('coc#snippet#enable', [this.bufnr, this.config.preferComplete ? 1 : 0], true)
    this._onActiveChange.fire(true)
  }

  public deactivate(): void {
    this.cancel()
    if (!this.isActive) return
    this.snippet = null
    this.current = null
    this.nvim.call('coc#snippet#disable', [this.bufnr], true)
    if (this.config.highlight) this.nvim.call('coc#highlight#clear_highlight', [this.bufnr, NAME_SPACE, 0, -1], true)
    this._onActiveChange.fire(false)
    logger.debug(`session ${this.bufnr} deactivate`)
  }

  public get placeholder(): CocSnippetPlaceholder | undefined {
    if (!this.snippet || !this.current) return undefined
    return this.snippet.getPlaceholderByMarker(this.current)
  }

  public cancel(pause = false): void {
    if (!this.isActive) return
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
    if (pause) this._paused = true
  }

  public dispose(): void {
    this.cancel()
    this._onActiveChange.dispose()
    this.snippet = null
    this.current = null
    this.textDocument = undefined
  }

  public async resolveSnippet(nvim: Neovim, snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    let context: UltiSnippetContext
    if (ultisnip) {
      // avoid all actions
      ultisnip = omit(ultisnip, ['actions'])
      context = Object.assign({
        range: Range.create(0, 0, 0, 0),
        line: ''
      }, ultisnip, { id: generateContextId(events.bufnr) })
      if (ultisnip.noPython !== true && snippetString.includes('`!p')) {
        await executePythonCode(nvim, getInitialPythonCode(context))
      }
    }
    const resolver = new SnippetVariableResolver(nvim, workspace.workspaceFolderControl)
    const snippet = new CocSnippet(snippetString, Position.create(0, 0), nvim, resolver)
    await snippet.init(context)
    return snippet.text
  }
}
