'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import { LinesTextDocument } from '../model/textdocument'
import { DidChangeTextDocumentParams, JumpInfo, TextDocumentContentChange, UltiSnippetOption } from '../types'
import { getTextEdit } from '../util/diff'
import { onUnexpectedError } from '../util/errors'
import { omit } from '../util/lodash'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
import { comparePosition, emptyRange, getEnd, positionInRange, rangeInRange } from '../util/position'
import { CancellationTokenSource, Emitter, Event } from '../util/protocol'
import { byteIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode } from './eval'
import { getPlaceholderId, Placeholder } from './parser'
import { CocSnippet, CocSnippetPlaceholder, getNextPlaceholder, reduceTextEdit } from "./snippet"
import { UltiSnippetContext } from './util'
import { SnippetVariableResolver } from "./variableResolve"
const logger = createLogger('snippets-session')
const NAME_SPACE = 'snippets'

interface DocumentChange {
  version: number
  change: TextDocumentContentChange
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
  private _force = false
  public snippet: CocSnippet = null
  private _onActiveChange = new Emitter<boolean>()
  private isStaled = false
  public readonly onActiveChange: Event<boolean> = this._onActiveChange.event

  constructor(
    private nvim: Neovim,
    public readonly document: Document,
    private readonly config: SnippetConfig
  ) {
  }

  public async start(inserted: string, range: Range, select = true, context?: UltiSnippetContext): Promise<boolean> {
    await this.forceSynchronize()
    let { document, snippet } = this
    const edits: TextEdit[] = []
    if (inserted.length === 0) return this.isActive
    if (snippet && rangeInRange(range, snippet.range)) {
      // update all snippet.
      let oldRange = snippet.range
      let previous = snippet.text
      let snip = await this.snippet.replaceWithSnippet(range, inserted, this.current, context)
      this.current = snip.first
      let edit = reduceTextEdit({
        range: oldRange,
        newText: this.snippet.text
      }, previous)
      edits.push(edit)
    } else {
      const resolver = new SnippetVariableResolver(this.nvim, workspace.workspaceFolderControl)
      snippet = new CocSnippet(inserted, range.start, this.nvim, resolver)
      await snippet.init(context)
      this.current = snippet.tmSnippet.first
      edits.push(TextEdit.replace(range, snippet.text))
      // try fix indent of remain text
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
    await this.applyEdits(edits)
    this.activate(snippet)
    let code = this.snippet.getUltiSnipAction(this.current, 'postExpand')
    // Not delay, avoid unexpected character insert
    if (code) await this.tryPostExpand(code)
    if (this.snippet && select && this.current) {
      let placeholder = this.snippet.getPlaceholderByMarker(this.current)
      await this.selectPlaceholder(placeholder, true)
    }
    return this.isActive
  }

  private async tryPostExpand(code: string): Promise<void> {
    const { start, end } = this.snippet.range
    let pos = `[${start.line},${start.character},${end.line},${end.character}]`
    let codes = [`snip = coc_ultisnips_dict["PostExpandContext"](${pos})`, code]
    this.cancel()
    await executePythonCode(this.nvim, codes)
    await this.forceSynchronize()
  }

  private async tryPostJump(code: string, info: JumpInfo, bufnr: number): Promise<void> {
    this.nvim.setVar('coc_ultisnips_tabstops', info.tabstops, true)
    const { snippet_start, snippet_end } = info
    let pos = `[${snippet_start.line},${snippet_start.character},${snippet_end.line},${snippet_end.character}]`
    let codes = [`snip = coc_ultisnips_dict["PostJumpContext"](${pos},${info.index},${info.forward ? 1 : 0})`, code]
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
    let curr = this.placeholder
    if (!curr) return
    if (this.snippet.getUltiSnipOption(curr.marker, 'removeWhiteSpace')) {
      await this.removeWhiteSpaceBefore(curr)
    }
    let snip = this.current.snippet
    const p = this.snippet.getPlaceholderOnJump(this.current, true)
    if (p && p.marker.snippet !== snip) {
      this.snippet.deactivateSnippet(snip)
    }
    await this.selectPlaceholder(p, true)
  }

  public async previousPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
    const p = this.snippet.getPlaceholderOnJump(this.current, false)
    await this.selectPlaceholder(p, true, false)
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    await this.forceSynchronize()
    if (!this.snippet) return
    let placeholder = this.snippet.getPlaceholderByMarker(this.current)
    if (placeholder) await this.selectPlaceholder(placeholder, triggerAutocmd)
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder | undefined, triggerAutocmd = true, forward = true): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    let { start, end } = placeholder.range
    const range = this.snippet.range
    const tabstops = this.snippet.getTabStopInfo()
    const line = document.getline(start.line)
    const col = byteIndex(line, start.character) + 1
    const marker = this.current = placeholder.marker
    if (marker instanceof Placeholder && marker.choice && marker.choice.options.length) {
      let sources = (await import('../completion/sources')).default
      sources.setWords(marker.choice.options.map(o => o.value), col - 1)
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, end, placeholder.value])
      if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
    } else {
      await this.select(placeholder, triggerAutocmd)
      this.highlights()
    }
    let info: JumpInfo = {
      forward,
      tabstops,
      snippet_start: range.start,
      snippet_end: range.end,
      index: placeholder.index,
      range: placeholder.range,
      charbefore: start.character == 0 ? '' : line.slice(start.character - 1, start.character)
    }
    let code = this.snippet.getUltiSnipAction(marker, 'postJump')
    // make it async to allow insertSnippet request from python code
    if (code) {
      await this.snippet.executeGlobalCode(marker.snippet)
      this.tryPostJump(code, info, document.bufnr).catch(onUnexpectedError)
    } else {
      void events.fire('PlaceholderJump', [document.bufnr, info])
    }
    this.checkFinalPlaceholder()
  }

  private checkFinalPlaceholder(): void {
    let current = this.current
    if (current && current.index === 0 && current.snippet === this.snippet.tmSnippet) {
      logger.info('Jump or change final placeholder, cancelling snippet session')
      this.deactivate()
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

  private async select(placeholder: CocSnippetPlaceholder, triggerAutocmd: boolean): Promise<void> {
    let { range, value } = placeholder
    let { nvim } = this
    if (value.length > 0) {
      await nvim.call('coc#snippet#select', [range.start, range.end, value])
    } else {
      await nvim.call('coc#snippet#move', [range.start])
    }
    if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
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
    if (this._applying || !this.isActive) return
    let changes = e.contentChanges
    // if not cancel, applyEdits would change latest document lines, which could be wrong.
    this.cancel()
    this.synchronize({ version: e.textDocument.version, change: changes[0] }).catch(onUnexpectedError)
  }

  public async synchronize(change?: DocumentChange): Promise<void> {
    const { document } = this
    this.isStaled = false
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
    let change = documentChange?.change
    if (!change) {
      let cursor = document.cursor
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
      let lc = newLines.length - (change.range.start.line - changeEnd.line + 1)
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
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    const nextPlaceholder = getNextPlaceholder(current, true)
    const { cursor } = document
    const id = getPlaceholderId(current)
    const noMove = events.completing && !this._force
    const res = await this.snippet.replaceWithText(change.range, change.text, tokenSource.token, current, cursor, noMove)
    this.tokenSource = undefined
    if (!res) {
      if (this.snippet) {
        this.isStaled = true
        // find out the cloned placeholder
        this.current = this.snippet.getPlaceholderById(id, current.index)
      }
      return
    }
    this.textDocument = newDocument
    if (!this.snippet.isValidPlaceholder(current)) {
      logger.info('Current placeholder destroyed, cancel snippet session')
      this.deactivate()
      return
    }
    let { snippetText, delta } = res
    let changedRange = Range.create(start, getEnd(start, snippetText))
    // check if snippet not changed as expected
    if (newDocument.getText(changedRange) !== snippetText) {
      logger.error(`Something went wrong with the snippet implementation`, change, snippetText)
      this.deactivate()
      return
    }
    if (res.marker instanceof Placeholder) {
      this.current = res.marker
    }
    let newText = this.snippet.text
    // further update caused by related placeholders or python CodeBlock change
    if (newText !== snippetText) {
      let edit = reduceTextEdit({ range: changedRange, newText }, snippetText)
      await this.applyEdits([edit], true)
      if (delta) this.nvim.call(`coc#cursor#move_to`, [cursor.line + delta.line, cursor.character + delta.character], true)
    }
    this.highlights()
    logger.debug('update cost:', Date.now() - startTs, res.delta === null)
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
    if (!this.isActive) return
    this._force = true
    await this.document.patchChange()
    await this.synchronize()
    this._force = false
  }

  public async onCompleteDone(): Promise<void> {
    if (this.isActive && this.isStaled) {
      this.isStaled = false
      await this.document.patchChange(true)
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
    this.nvim.call('coc#snippet#enable', [this.config.preferComplete ? 1 : 0], true)
    this._onActiveChange.fire(true)
  }

  public deactivate(): void {
    this.cancel()
    if (!this.isActive) return
    this.snippet = null
    this.current = null
    this.nvim.call('coc#snippet#disable', [], true)
    if (this.config.highlight) this.nvim.call('coc#highlight#clear_highlight', [this.bufnr, NAME_SPACE, 0, -1], true)
    this._onActiveChange.fire(false)
    logger.debug(`session ${this.bufnr} deactivate`)
  }

  public get placeholder(): CocSnippetPlaceholder | undefined {
    if (!this.snippet || !this.current) return undefined
    return this.snippet.getPlaceholderByMarker(this.current)
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
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
    let position = Position.create(0, 0)
    if (ultisnip) {
      // avoid all actions
      ultisnip = omit(ultisnip, ['actions'])
      if (this.snippet?.hasPython) {
        ultisnip.noPython = true
      }
      let line = ultisnip && typeof ultisnip.line === 'string' ? ultisnip.line : this.document.getline(position.line)
      context = Object.assign({ range: Range.create(position, position), line }, ultisnip)
    }
    const resolver = new SnippetVariableResolver(nvim, workspace.workspaceFolderControl)
    let snippet = new CocSnippet(snippetString, position, nvim, resolver)
    await snippet.init(context)
    return snippet.text
  }
}
