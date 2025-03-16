'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import { LinesTextDocument } from '../model/textdocument'
import { DidChangeTextDocumentParams, JumpInfo, TextDocumentContentChange, UltiSnippetOption } from '../types'
import { onUnexpectedError } from '../util/errors'
import { Mutex } from '../util/mutex'
import { deepClone, equals } from '../util/object'
import { comparePosition, getEnd, positionInRange, rangeInRange } from '../util/position'
import { CancellationTokenSource, Emitter, Event } from '../util/protocol'
import { byteIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { executePythonCode } from './eval'
import { Marker, Placeholder, TextmateSnippet } from './parser'
import { checkContentBefore, checkCursor, CocSnippet, CocSnippetPlaceholder, equalToPosition, getEndPosition, getParts, reduceTextEdit } from "./snippet"
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
  private current: Marker
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

  public onChange(e: DidChangeTextDocumentParams): void {
    if (this._applying || !this.isActive) return
    let changes = e.contentChanges
    this.synchronize({ version: e.textDocument.version, change: changes[0] }).catch(onUnexpectedError)
  }

  public async start(inserted: string, range: Range, select = true, context?: UltiSnippetContext): Promise<boolean> {
    await this.forceSynchronize()
    let { document, snippet } = this
    const placeholder = this.getReplacePlaceholder(range)
    const edits: TextEdit[] = []
    if (inserted.length === 0) return this.isActive
    if (snippet && placeholder) {
      // update all snippet.
      let r = snippet.range
      let previous = document.textDocument.getText(r)
      let parts = getParts(placeholder.value, placeholder.range, range)
      this.current = await this.snippet.insertSnippet(placeholder, inserted, parts, context)
      let edit = reduceTextEdit({
        range: r,
        newText: this.snippet.text
      }, previous)
      edits.push(edit)
    } else {
      const resolver = new SnippetVariableResolver(this.nvim, workspace.workspaceFolderControl)
      snippet = new CocSnippet(inserted, range.start, this.nvim, resolver)
      await snippet.init(context)
      this.current = snippet.firstPlaceholder!.marker
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
    this.deleteVimGlobal()
    await this.applyEdits(edits)
    this.textDocument = document.textDocument
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
    this._applying = true
    await this.document.applyEdits(edits)
    this._applying = false
  }

  /**
   * TODO remove this
   */
  private getReplacePlaceholder(range: Range): CocSnippetPlaceholder | undefined {
    if (!this.snippet) return undefined
    let placeholder = this.findPlaceholder(range)
    if (!placeholder || placeholder.index == 0) return undefined
    return placeholder
  }

  public async nextPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
    if (this.snippet.getUltiSnipOption(curr.marker, 'removeWhiteSpace')) {
      const { before, after, range, value } = curr
      let ms = before.match(/\s+$/)
      if (value === '' && after.startsWith('\n') && ms) {
        let startCharacter = range.start.character - ms[0].length
        let textEdit = TextEdit.del(Range.create(Position.create(range.start.line, startCharacter), deepClone(range.start)))
        await this.document.applyEdits([textEdit])
        await this.forceSynchronize()
      }
    }
    let next = this.snippet.getNextPlaceholder(curr.index)
    if (next) await this.selectPlaceholder(next, true)
  }

  public async previousPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
    let prev = this.snippet.getPrevPlaceholder(curr.index)
    if (prev) await this.selectPlaceholder(prev, true, false)
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
      logger.info('Jump to final placeholder, cancelling snippet session')
      this.deactivate()
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

  private highlights(placeholder: CocSnippetPlaceholder, redrawVim = true): void {
    if (!this.config.highlight) return
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

  /**
   * TODO remove this
   */
  public findPlaceholder(range: Range): CocSnippetPlaceholder | null {
    let { placeholder } = this
    if (placeholder && rangeInRange(range, placeholder.range)) return placeholder
    return this.snippet.getPlaceholderByRange(range) || null
  }

  public async synchronize(change?: DocumentChange): Promise<void> {
    await this.mutex.use(() => {
      if (change && (this.document.version != change.version || change.version - this.version !== 1)) {
        // can't be used any more
        change = undefined
      }
      return this._synchronize(change ? change.change : undefined)
    })
  }

  public async _synchronize(change?: TextDocumentContentChange): Promise<void> {
    let { document, textDocument } = this
    if (!document.attached || !this.isActive) return
    let start = Date.now()
    let d = document.textDocument
    if (d.version == textDocument.version || equals(textDocument.lines, d.lines)) return
    let { range, text } = this.snippet
    if (change && !rangeInRange(change.range, range)) change = undefined
    let end = getEndPosition(range.end, textDocument, d)
    if (this._actioning) {
      // allow change after end
      if (equalToPosition(range.end, textDocument, d)) {
        this.textDocument = document.textDocument
        return
      }
    }
    if (!end) {
      logger.info('Content change after snippet, cancel snippet session')
      this.deactivate()
      return
    }
    let checked = checkContentBefore(range.start, textDocument, d)
    if (!checked) {
      let content = d.getText(Range.create(Position.create(0, 0), end))
      if (content.endsWith(text)) {
        let pos = d.positionAt(content.length - text.length)
        this.snippet.resetStartPosition(pos)
        this.textDocument = d
        logger.info('Content change before snippet, reset snippet position')
        return
      }
      logger.info('Before and snippet body changed, cancel snippet session')
      this.deactivate()
      return
    }
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let cursor = await window.getCursorPosition()
    if (tokenSource.token.isCancellationRequested || document.hasChanged) return
    let placeholder: CocSnippetPlaceholder
    let newText: string | undefined
    let inserted = d.getText(Range.create(range.start, end))
    let curr = this.placeholder
    if (change) {
      for (let p of this.snippet.getSortedPlaceholders(curr)) {
        if (rangeInRange(change.range, p.range)) {
          placeholder = p
          newText = this.snippet.getNewText(p, inserted)
          break
        }
      }
    } else {
      for (let p of this.snippet.getSortedPlaceholders(curr)) {
        if (comparePosition(cursor, p.range.start) < 0) continue
        newText = this.snippet.getNewText(p, inserted)
        // p.range.start + newText
        if (newText != null && checkCursor(p.range.start, cursor, newText)) {
          placeholder = p
          break
        }
      }
    }
    if (!placeholder && inserted.endsWith(text)) {
      let pos = getEnd(range.start, inserted.slice(0, - text.length))
      this.snippet.resetStartPosition(pos)
      this.textDocument = d
      logger.info('Content change before snippet, reset snippet position')
      return
    }
    if (!placeholder) {
      logger.info('Unable to find changed placeholder, cancel snippet session')
      this.deactivate()
      return
    }
    let res = await this.snippet.updatePlaceholder(placeholder, cursor, newText, tokenSource.token)
    if (res == null || tokenSource.token.isCancellationRequested) return
    // happens when applyEdits just after TextInsert
    if (document.dirty || !equals(document.textDocument.lines, d.lines)) {
      tokenSource.cancel()
      tokenSource.dispose()
      return
    }
    tokenSource.dispose()
    this.current = placeholder.marker
    if (res.text !== inserted) {
      let edit = reduceTextEdit({
        range: Range.create(this.snippet.start, end),
        newText: res.text
      }, inserted)
      await this.applyEdits([edit])
      let { delta } = res
      if (delta.line != 0 || delta.character != 0) {
        this.nvim.call(`coc#cursor#move_to`, [cursor.line + delta.line, cursor.character + delta.character], true)
      }
      this.highlights(placeholder, false)
      this.nvim.redrawVim()
    } else {
      this.highlights(placeholder)
    }
    logger.debug('update cost:', Date.now() - start, res.delta)
    this.textDocument = this.document.textDocument
    if (this.config.nextOnDelete) {
      if (curr && curr.value.length > 0 && placeholder.marker.toString() === '') {
        let next = this.snippet.getNextPlaceholder(placeholder.index)
        if (next) await this.selectPlaceholder(next)
      }
    }
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

  private deleteVimGlobal() {
    this.nvim.call('coc#compat#del_var', ['coc_selected_text'], true)
    this.nvim.call('coc#compat#del_var', ['coc_last_placeholder'], true)
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

  public static async resolveSnippet(nvim: Neovim, snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    let position = ultisnip && Range.is(ultisnip.range) ? ultisnip.range.start : await window.getCursorPosition()
    let line = ultisnip && typeof ultisnip.line === 'string' ? ultisnip.line : await nvim.line
    let context: UltiSnippetContext
    if (ultisnip) context = Object.assign({ range: Range.create(position, position), line }, ultisnip)
    const resolver = new SnippetVariableResolver(nvim, workspace.workspaceFolderControl)
    let snippet = new CocSnippet(snippetString, position, nvim, resolver)
    // TODO Don't resolve python when python snippet activated
    await snippet.init(context)
    return snippet.text
  }
}
