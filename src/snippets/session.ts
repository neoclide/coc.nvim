'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import events from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import { LinesTextDocument } from '../model/textdocument'
import { JumpInfo, TextDocumentContentChange, UltiSnippetOption } from '../types'
import { Mutex } from '../util/mutex'
import { deepClone, equals } from '../util/object'
import { comparePosition, emptyRange, getEnd, isSingleLine, positionInRange, rangeInRange } from '../util/position'
import { CancellationTokenSource, Disposable, Emitter, Event } from '../util/protocol'
import { byteIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { UltiSnippetContext } from './eval'
import { Marker, Placeholder } from './parser'
import { checkContentBefore, checkCursor, CocSnippet, CocSnippetPlaceholder, getEndPosition, getParts, reduceTextEdit } from "./snippet"
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
  private current: Marker
  private textDocument: LinesTextDocument
  private tokenSource: CancellationTokenSource
  private disposable: Disposable
  public mutex = new Mutex()
  private removeWhiteSpace = false
  private _applying = false
  private _isActive = false
  private _snippet: CocSnippet = null
  private _onCancelEvent = new Emitter<void>()
  public readonly onCancel: Event<void> = this._onCancelEvent.event

  constructor(
    private nvim: Neovim,
    public readonly document: Document,
    private readonly config: SnippetConfig
  ) {
    this.disposable = document.onDocumentChange(async e => {
      if (this._applying || !this._isActive) return
      let changes = e.contentChanges
      await this.synchronize({ version: e.textDocument.version, change: changes[0] })
    })
  }

  public async start(inserted: string, range: Range, select = true, context?: UltiSnippetContext): Promise<boolean> {
    const { document } = this
    const placeholder = this.getReplacePlaceholder(range)
    const edits: TextEdit[] = []
    if (context?.removeWhiteSpace) this.removeWhiteSpace = true
    if (placeholder) {
      // update all snippet.
      let r = this.snippet.range
      let previous = document.textDocument.getText(r)
      let parts = getParts(placeholder.value, placeholder.range, range)
      this.current = await this.snippet.insertSnippet(placeholder, inserted, parts, context)
      this.deleteVimGlobal()
      let edit = reduceTextEdit({
        range: r,
        newText: this.snippet.text
      }, previous)
      edits.push(edit)
    } else {
      const resolver = new SnippetVariableResolver(this.nvim, workspace.workspaceFolderControl)
      let snippet = new CocSnippet(inserted, range.start, this.nvim, resolver)
      await snippet.init(context)
      this.deleteVimGlobal()
      this._snippet = snippet
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
    await this.applyEdits(edits)
    this.textDocument = document.textDocument
    this.activate()
    if (select && this.current) {
      let placeholder = this.snippet.getPlaceholderByMarker(this.current)
      await this.selectPlaceholder(placeholder, true)
    }
    return this._isActive
  }

  private async applyEdits(edits: TextEdit[]): Promise<void> {
    this._applying = true
    await this.document.applyEdits(edits)
    this._applying = false
  }

  /**
   * Get valid placeholder to insert
   */
  private getReplacePlaceholder(range: Range): CocSnippetPlaceholder | undefined {
    if (!this.snippet) return undefined
    let placeholder = this.findPlaceholder(range)
    if (!placeholder || placeholder.index == 0) return undefined
    return placeholder
  }

  private deleteVimGlobal() {
    this.nvim.call('coc#compat#del_var', ['coc_selected_text'], true)
    this.nvim.call('coc#compat#del_var', ['coc_last_placeholder'], true)
  }

  private activate(): void {
    if (this._isActive) return
    this._isActive = true
    this.nvim.call('coc#snippet#enable', [this.config.preferComplete ? 1 : 0], true)
  }

  public deactivate(): void {
    this.cancel()
    if (!this._isActive) return
    this.disposable.dispose()
    this._isActive = false
    this._snippet = undefined
    this.current = null
    this.nvim.call('coc#snippet#disable', [], true)
    if (this.config.highlight) this.nvim.call('coc#highlight#clear_highlight', [this.bufnr, NAME_SPACE, 0, -1], true)
    this._onCancelEvent.fire(void 0)
    logger.debug(`session ${this.bufnr} cancelled`)
  }

  public get isActive(): boolean {
    return this._isActive
  }

  public get bufnr(): number {
    return this.document.bufnr
  }

  public async nextPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
    if (this.removeWhiteSpace) {
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
    if (next) await this.selectPlaceholder(next)
  }

  public async previousPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
    let prev = this.snippet.getPrevPlaceholder(curr.index)
    if (prev) await this.selectPlaceholder(prev)

  }

  public async selectCurrentPlaceholder(triggerAutocmd = true): Promise<void> {
    await this.forceSynchronize()
    if (!this.snippet) return
    let placeholder = this.snippet.getPlaceholderByMarker(this.current)
    if (placeholder) await this.selectPlaceholder(placeholder, triggerAutocmd)
  }

  public async selectPlaceholder(placeholder: CocSnippetPlaceholder, triggerAutocmd = true): Promise<void> {
    let { nvim, document } = this
    if (!document || !placeholder) return
    let { start, end } = placeholder.range
    const line = document.getline(start.line)
    const col = byteIndex(line, start.character) + 1
    let marker = this.current = placeholder.marker
    if (marker instanceof Placeholder && marker.choice && marker.choice.options.length) {
      let sources = (await import('../completion/sources')).default
      sources.setWords(marker.choice.options.map(o => o.value), col - 1)
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, end, placeholder.value])
      if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
    } else {
      let finalCount = this.snippet.finalCount
      await this.select(placeholder, triggerAutocmd)
      this.highlights(placeholder)
      if (placeholder.index == 0) {
        if (finalCount == 1) {
          logger.info('Jump to final placeholder, cancelling snippet session')
          this.deactivate()
        } else {
          nvim.call('coc#snippet#disable', [], true)
        }
      }
    }
    let info: JumpInfo = {
      range: placeholder.range,
      charbefore: start.character == 0 ? '' : line.slice(start.character - 1, start.character)
    }
    void events.fire('PlaceholderJump', [document.bufnr, info])
  }

  private highlights(placeholder: CocSnippetPlaceholder, redrawVim = true): void {
    if (!this.config.highlight) return
    // this.checkPosition
    let buf = this.document.buffer
    this.nvim.pauseNotification()
    buf.clearNamespace(NAME_SPACE)
    let ranges = this.snippet.getRanges(placeholder)
    if (ranges.length) {
      buf.highlightRanges(NAME_SPACE, 'CocSnippetVisual', ranges)
    }
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

  public findPlaceholder(range: Range): CocSnippetPlaceholder | null {
    let { placeholder } = this
    if (placeholder && rangeInRange(range, placeholder.range)) return placeholder
    return this.snippet.getPlaceholderByRange(range) || null
  }

  public get version(): number {
    return this.textDocument ? this.textDocument.version : -1
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
    if (!document.attached || !this._isActive) return
    let start = Date.now()
    let d = document.textDocument
    if (d.version == textDocument.version || equals(textDocument.lines, d.lines)) return
    let { range, text } = this.snippet
    if (change && !rangeInRange(change.range, range)) change = undefined
    let end = getEndPosition(range.end, textDocument, d)
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
      // Check Text delete
      if (!placeholder && change.text.length == 0 && !emptyRange(change.range) && isSingleLine(change.range)) {
        let length = change.range.end.character - change.range.start.character
        let offset = d.getText(Range.create(range.start, change.range.start)).length
        if (this.snippet.removeText(offset, length)) {
          this.textDocument = d
          return
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
    let release = await this.mutex.acquire()
    release()
    // text change event may not fired
    if (this.document.version !== this.version) {
      await this.synchronize()
    }
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public get placeholder(): CocSnippetPlaceholder | undefined {
    if (!this.snippet || !this.current) return undefined
    return this.snippet.getPlaceholderByMarker(this.current)
  }

  public get snippet(): CocSnippet {
    return this._snippet
  }

  public static async resolveSnippet(nvim: Neovim, snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    let position = ultisnip && Range.is(ultisnip.range) ? ultisnip.range.start : await window.getCursorPosition()
    let line = ultisnip && typeof ultisnip.line === 'string' ? ultisnip.line : await nvim.line
    let context: UltiSnippetContext
    if (ultisnip) context = Object.assign({ range: Range.create(position, position), line }, ultisnip)
    const resolver = new SnippetVariableResolver(nvim, workspace.workspaceFolderControl)
    let snippet = new CocSnippet(snippetString, position, nvim, resolver)
    await snippet.init(context)
    return snippet.text
  }
}
