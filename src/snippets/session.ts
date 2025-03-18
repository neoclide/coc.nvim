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
import { byteIndex, toText } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode } from './eval'
import { Placeholder, TextmateSnippet } from './parser'
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
  private _actioning = false
  public snippet: CocSnippet = null
  private _onActiveChange = new Emitter<boolean>()
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
    // const placeholder = this.getReplacePlaceholder(range)
    const edits: TextEdit[] = []
    if (inserted.length === 0) return this.isActive
    if (snippet) {
      // update all snippet.
      let range = snippet.range
      let previous = document.textDocument.getText(range)
      let snip = await this.snippet.replaceWithSnippet(range, inserted, this.current, context)
      this.current = snip.first
      let edit = reduceTextEdit({
        range,
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
    let code = this.snippet ? this.snippet.getUltiSnipAction(this.current, 'postExpand') : undefined
    if (code) await this.tryPostExpand(code)
    // TODO later post expand?
    if (this.snippet && select && this.current) {
      let placeholder = this.snippet.getPlaceholderByMarker(this.current)
      await this.selectPlaceholder(placeholder, true)
    }
    return this.isActive
  }

  private async tryPostExpand(code: string): Promise<void> {
    const { start, end } = this.snippet.range
    this._actioning = true
    let pos = `[${start.line},${start.character},${end.line},${end.character}]`
    let codes = [`snip = coc_ultisnips_dict["PostExpandContext"](${pos})`, code]
    await executePythonCode(this.nvim, codes, true)
    await this.forceSynchronize()
    this._actioning = false
  }

  private async applyEdits(edits: TextEdit[]): Promise<void> {
    let { document } = this
    this._applying = true
    await document.applyEdits(edits, true)
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
    const p = this.snippet.getPlaceholderOnJump(this.current, true)
    if (p) await this.selectPlaceholder(p, true)
  }

  public async removeWhiteSpaceBefore(placeholder: CocSnippetPlaceholder): Promise<void> {
    if (placeholder.value.length > 0) return
    let pos = placeholder.range.start
    let line = toText(this.snippet.lineAt(pos.line))
    let ms = line.match(/\s+$/)
    if (ms && line.length === pos.character) {
      let startCharacter = pos.character - ms[0].length
      let textEdit = TextEdit.del(Range.create(pos.line, startCharacter, pos.line, pos.character))
      await this.document.applyEdits([textEdit])
      await this.forceSynchronize()
    }
  }

  public async previousPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
    const p = this.snippet.getPlaceholderOnJump(this.current, false)
    if (p) await this.selectPlaceholder(p, true)
  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    await this.forceSynchronize()
    if (!this.snippet) return
    let placeholder = this.snippet.getPlaceholderByMarker(this.current)
    if (placeholder) await this.selectPlaceholder(placeholder, triggerAutocmd)
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder, triggerAutocmd = true, forward = true): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    let { start, end } = placeholder.range
    const range = this.snippet.range
    const tabstops = this.snippet.getTabStopInfo()
    const line = document.getline(start.line)
    const col = byteIndex(line, start.character) + 1
    let marker = this.current = placeholder.marker
    if (marker instanceof Placeholder && marker.choice && marker.choice.options.length) {
      let sources = (await import('../completion/sources')).default
      sources.setWords(marker.choice.options.map(o => o.value), col - 1)
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, end, placeholder.value])
      if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
    } else {
      await this.select(placeholder, triggerAutocmd)
      this.highlights(placeholder)
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
      this.tryPostJump(marker.snippet, code, info, document.bufnr).catch(onUnexpectedError)
    } else {
      void events.fire('PlaceholderJump', [document.bufnr, info])
    }
    if (placeholder.index == 0) {
      let snip = marker.snippet
      if (snip === this.snippet.tmSnippet) {
        logger.info('Jump to final placeholder, cancelling snippet session')
        this.deactivate()
      } else {
        this.snippet.deactivateSnippet(snip)
      }
    }
  }

  private async tryPostJump(snip: TextmateSnippet, code: string, info: JumpInfo, bufnr: number): Promise<void> {
    await this.nvim.setVar('coc_ultisnips_tabstops', info.tabstops)
    await this.snippet.executeGlobalCode(snip)
    const { snippet_start, snippet_end } = info
    this._actioning = true
    let pos = `[${snippet_start.line},${snippet_start.character},${snippet_end.line},${snippet_end.character}]`
    let codes = [`snip = coc_ultisnips_dict["PostJumpContext"](${pos},${info.index},${info.forward ? 1 : 0})`, code]
    await executePythonCode(this.nvim, codes, true)
    await this.forceSynchronize()
    this._actioning = false
    void events.fire('PlaceholderJump', [bufnr, info])
  }

  private highlights(placeholder: CocSnippetPlaceholder | undefined, redrawVim = true): void {
    if (!placeholder || !this.config.highlight) return
    // this.checkPosition
    let buf = this.document.buffer
    this.nvim.pauseNotification()
    buf.clearNamespace(NAME_SPACE)
    let ranges = this.snippet.getRanges(placeholder)
    buf.highlightRanges(NAME_SPACE, 'CocSnippetVisual', ranges)
    this.nvim.resumeNotification(redrawVim, true)
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

  public onChange(e: DidChangeTextDocumentParams): void {
    if (this._applying || !this.isActive) return
    let changes = e.contentChanges
    this.synchronize({ version: e.textDocument.version, change: changes[0] }).catch(onUnexpectedError)
  }

  public async synchronize(change?: DocumentChange): Promise<void> {
    await this.mutex.use(() => {
      if (change && (this.document.version != change.version || change.version - this.version !== 1)) {
        // can't be used any more
        change = undefined
      }
      let textDocument = this.document.textDocument
      return this._synchronize(change).then(res => {
        if (res === true) this.textDocument = textDocument
      })
    })
  }

  public async _synchronize(documentChange?: DocumentChange): Promise<boolean> {
    let { document, textDocument, current } = this
    if (!textDocument ||
      !document.attached ||
      !this.snippet ||
      document.version !== documentChange.version) return false
    const startTs = Date.now()
    const newDocument = document.textDocument
    if (equals(textDocument.lines, newDocument.lines)) return true
    let change = documentChange.change
    if (change && documentChange.version - textDocument.version !== 1) {
      let cursor = document.cursor
      let edit = getTextEdit(textDocument.lines, newDocument.lines, cursor, events.insertMode)
      if (!edit) return true
      change = { range: edit.range, text: edit.newText }
    }
    let { range } = this.snippet
    let c = comparePosition(change.range.start, range.end)
    // consider insert at the end
    let insertEnd = emptyRange(change.range) && this.snippet.hasEndPlaceholder
    // change after snippet, do nothing
    if (c > 0 || (c === 0 && !insertEnd)) return true
    // consider insert at the beginning
    c = comparePosition(change.range.end, range.start)
    let insertBeginning = emptyRange(change.range) && this.snippet.hasBeginningPlaceholder
    const { start } = this.snippet
    if (c < 0 || (c === 0 && !insertBeginning)) {
      // change before beginning, reset position
      let changeEnd = change.range.end
      let checkCharacter = range.start.line === changeEnd.line
      let newLines = change.text.split(/\n/)
      let lc = (change.range.start.line - changeEnd.line + 1) - newLines.length
      let cc = 0
      if (checkCharacter) {
        if (newLines.length > 1) {
          cc = newLines[newLines.length - 1].length - changeEnd.character
        } else {
          cc = change.range.start.character + change.text.length - changeEnd.character
        }
      }
      this.snippet.resetStartPosition(Position.create(start.line + lc, start.character + cc))
      logger.info('Content change before snippet, reset snippet position')
      return true
    }
    if (!rangeInRange(change.range, range)) {
      logger.info('Before and snippet body changed, cancel snippet session')
      this.deactivate()
      return false
    }
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    const nextPlaceholder = getNextPlaceholder(current, true)
    let res = await this.snippet.replaceWithText(change.range, change.text, tokenSource.token, this.current, document.cursor)
    tokenSource.dispose()
    if (!res || tokenSource.token.isCancellationRequested) return false
    let { snippetText, cursor } = res
    let rangeEnd = getEnd(start, snippetText)
    let changedRange = Range.create(start, rangeEnd)
    if (newDocument.getText(changedRange) !== snippetText) {
      logger.error(`something went wrong with the snippet implementation`, change, snippetText)
      this.deactivate()
      return false
    }
    let newText = this.snippet.text
    // further update caused by placeholders
    if (newText !== snippetText) {
      let edit = reduceTextEdit({ range: changedRange, newText }, snippetText)
      await this.applyEdits([edit])
      if (res.cursor) this.nvim.call(`coc#cursor#move_to`, [cursor.line, cursor.character], true)
    }
    let placeholder = res.marker instanceof Placeholder ? res.marker : undefined
    if (placeholder) {
      this.current = placeholder
      this.highlights(this.snippet.getPlaceholderByMarker(placeholder), false)
    }
    this.nvim.redrawVim()
    logger.debug('update cost:', Date.now() - startTs, res.cursor)
    this.trySelectNextOnDelete(current, nextPlaceholder).catch(onUnexpectedError)
    return true
  }

  public async trySelectNextOnDelete(curr: Placeholder, placeholder: Placeholder | undefined): Promise<void> {
    if (!this.config.nextOnDelete
      || !curr
      || (curr.snippet != null && curr.toString() != '')
      || !placeholder
    ) return
    let p = this.snippet.getPlaceholderByMarker(placeholder)
    // the placeholder could be removed
    if (p) await this.selectPlaceholder(p, true)
  }

  public async forceSynchronize(): Promise<void> {
    await this.document.patchChange()
    if (!this.isActive) return
    let release = await this.mutex.acquire()
    release()
    // text change event may not fired
    if (this.document.version !== this.version) {
      await this.synchronize()
    }
  }

  public get version(): number {
    return this.textDocument ? this.textDocument.version : -1
  }

  public get snippetRange(): Range | null {
    return this.snippet?.range
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
    let position = Range.is(ultisnip?.range) ? ultisnip.range.start : (this.document.cursor ?? Position.create(0, 0))
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
