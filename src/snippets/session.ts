import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Emitter, Event, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import completion from '../completion'
import events from '../events'
import Document from '../model/document'
import { LinesTextDocument } from '../model/textdocument'
import { UltiSnippetOption } from '../types'
import { equals } from '../util/object'
import { comparePosition, positionInRange, rangeInRange } from '../util/position'
import { byteLength } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { UltiSnippetContext } from './eval'
import { Marker, Placeholder } from './parser'
import { checkContentBefore, checkCursor, CocSnippet, CocSnippetPlaceholder, getEnd, getEndPosition, getParts, reduceTextEdit } from "./snippet"
import { SnippetVariableResolver } from "./variableResolve"
const logger = require('../util/logger')('snippets-session')
const NAME_SPACE = 'snippets'

export class SnippetSession {
  private current: Marker
  private textDocument: LinesTextDocument
  private tokenSource: CancellationTokenSource
  private timer: NodeJS.Timer
  private _isActive = false
  private _snippet: CocSnippet = null
  private _onCancelEvent = new Emitter<void>()
  public readonly onCancel: Event<void> = this._onCancelEvent.event

  constructor(
    private nvim: Neovim,
    public readonly bufnr: number,
    private enableHighlight = false,
    private preferComplete = false
  ) {
  }

  public async start(inserted: string, range: Range, select = true, context?: UltiSnippetContext): Promise<boolean> {
    const { document } = this
    const placeholder = this.getReplacePlaceholder(range)
    const edits: TextEdit[] = []
    if (placeholder) {
      // update all snippet.
      let r = this.snippet.range
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
      let snippet = new CocSnippet(inserted, range.start, this.nvim, resolver)
      await snippet.init(context)
      this._snippet = snippet
      this.current = snippet.firstPlaceholder?.marker
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
    await document.applyEdits(edits)
    this.textDocument = document.textDocument
    this.activate()
    if (select && this.current) {
      let placeholder = this.snippet.getPlaceholderByMarker(this.current)
      await this.selectPlaceholder(placeholder, true)
    }
    return this._isActive
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

  private activate(): void {
    if (this._isActive) return
    this._isActive = true
    this.nvim.call('coc#snippet#enable', [], true)
  }

  public deactivate(): void {
    this.cancel()
    if (!this._isActive) return
    this._isActive = false
    this.current = null
    this.nvim.call('coc#snippet#disable', [], true)
    if (this.enableHighlight) this.nvim.call('coc#highlight#clear_highlight', [this.bufnr, NAME_SPACE, 0, -1], true)
    this._onCancelEvent.fire(void 0)
    logger.debug(`session ${this.bufnr} cancelled`)
  }

  public get isActive(): boolean {
    return this._isActive
  }

  public async nextPlaceholder(): Promise<void> {
    await this.forceSynchronize()
    let curr = this.placeholder
    if (!curr) return
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
    const len = end.character - start.character
    const col = byteLength(document.getline(start.line).slice(0, start.character)) + 1
    let marker = this.current = placeholder.marker
    if (marker instanceof Placeholder
      && marker.choice
      && marker.choice.options.length
    ) {
      let arr = marker.choice.options.map(o => o.value)
      await nvim.call('coc#snippet#show_choices', [start.line + 1, col, len, arr])
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
  }

  private highlights(placeholder: CocSnippetPlaceholder): void {
    if (!this.enableHighlight) return
    // this.checkPosition
    let buf = this.nvim.createBuffer(this.bufnr)
    this.nvim.pauseNotification()
    buf.clearNamespace(NAME_SPACE)
    let ranges = this.snippet.getRanges(placeholder)
    if (ranges.length) {
      buf.highlightRanges(NAME_SPACE, 'CocSnippetVisual', ranges)
    }
    void this.nvim.resumeNotification(true, true)
  }

  private async select(placeholder: CocSnippetPlaceholder, triggerAutocmd = true): Promise<void> {
    let { range } = placeholder
    let { document, nvim } = this
    let { start, end } = range
    let { textDocument } = document
    let len = textDocument.offsetAt(end) - textDocument.offsetAt(start)
    let line = document.getline(start.line)
    let col = line ? byteLength(line.slice(0, start.character)) : 0
    let endLine = document.getline(end.line)
    let endCol = endLine ? byteLength(endLine.slice(0, end.character)) : 0
    let [ve, selection, pumvisible, mode] = await nvim.eval('[&virtualedit, &selection, pumvisible(), mode()]') as [string, string, number, string]
    let move_cmd = ''
    if (pumvisible && this.preferComplete) {
      let pre = completion.hasSelected() ? '' : '\\<C-n>'
      await nvim.eval(`feedkeys("${pre}\\<C-y>", 'in')`)
      return
    }
    // create move cmd
    if (mode != 'n') move_cmd += "\\<Esc>"
    if (len == 0) {
      if (col == 0 || (!mode.startsWith('i') && col < byteLength(line))) {
        move_cmd += 'i'
      } else {
        move_cmd += 'a'
      }
    } else {
      move_cmd += 'v'
      endCol = await this.getVirtualCol(end.line + 1, endCol)
      if (selection == 'inclusive') {
        if (end.character == 0) {
          move_cmd += `${end.line}G`
        } else {
          move_cmd += `${end.line + 1}G${endCol}|`
        }
      } else if (selection == 'old') {
        move_cmd += `${end.line + 1}G${endCol}|`
      } else {
        move_cmd += `${end.line + 1}G${endCol + 1}|`
      }
      col = await this.getVirtualCol(start.line + 1, col)
      move_cmd += `o${start.line + 1}G${col + 1}|o\\<c-g>`
    }
    if (mode == 'i' && move_cmd == "\\<Esc>a") {
      move_cmd = ''
    }
    nvim.pauseNotification()
    nvim.setOption('virtualedit', 'onemore', true)
    nvim.call('cursor', [start.line + 1, col + (move_cmd == 'a' ? 0 : 1)], true)
    if (move_cmd) {
      nvim.call('eval', [`feedkeys("${move_cmd}", 'in')`], true)
    }
    if (pumvisible) {
      nvim.call('coc#_cancel', [], true)
    }
    nvim.setOption('virtualedit', ve, true)
    await nvim.resumeNotification(true)
    if (triggerAutocmd) nvim.call('coc#util#do_autocmd', ['CocJumpPlaceholder'], true)
  }

  private async getVirtualCol(line: number, col: number): Promise<number> {
    let { nvim } = this
    return await nvim.eval(`virtcol([${line}, ${col}])`) as number
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

  public sychronize(): void {
    this.cancel()
    this.timer = setTimeout(async () => {
      let { document } = this
      if (!document || !document.attached || document.dirty) return
      try {
        await this._synchronize()
      } catch (e) {
        this.nvim.echoError(e)
      }
    }, global.__TEST__ ? 50 : 200)
  }

  public async _synchronize(): Promise<void> {
    let { document, textDocument } = this
    if (!document || !document.attached || !this._isActive) return
    let start = Date.now()
    let d = document.textDocument
    if (d.version == textDocument.version || equals(textDocument.lines, d.lines)) {
      return
    }
    let { range, text } = this.snippet
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
    if (tokenSource.token.isCancellationRequested || document.dirty) return
    let inserted = d.getText(Range.create(range.start, end))
    let newText: string | undefined
    let placeholder: CocSnippetPlaceholder
    let curr = this.placeholder
    for (let p of this.snippet.getSortedPlaceholders(curr)) {
      if (comparePosition(cursor, p.range.start) < 0) continue
      newText = this.snippet.getNewText(p, inserted)
      // p.range.start + newText
      if (newText != null && checkCursor(p.range.start, cursor, newText)) {
        placeholder = p
        break
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
    if (!res || !this.document) return
    if (shouldCancel(tokenSource.token, document, res.delta)) {
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
      await this.document.applyEdits([edit])
      this.highlights(placeholder)
      let { delta } = res
      if (delta.line != 0 || delta.character != 0) {
        this.nvim.call(`coc#cursor#move_to`, [cursor.line + delta.line, cursor.character + delta.character], true)
      }
      this.nvim.redrawVim()
    } else {
      this.highlights(placeholder)
    }
    logger.debug('update cost:', Date.now() - start, res.delta)
    this.textDocument = this.document.textDocument
  }

  public async forceSynchronize(): Promise<void> {
    this.cancel()
    let { document } = this
    if (document && document.attached) {
      await document.patchChange()
      await this._synchronize()
    }
  }

  public cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
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

  private get document(): Document {
    return workspace.getDocument(this.bufnr)
  }

  public static async resolveSnippet(nvim: Neovim, snippetString: string, ultisnip?: UltiSnippetOption): Promise<string> {
    let position = await window.getCursorPosition()
    let line = await nvim.line
    let context: UltiSnippetContext
    if (ultisnip) context = Object.assign({ range: Range.create(position, position), line }, ultisnip)
    const resolver = new SnippetVariableResolver(nvim, workspace.workspaceFolderControl)
    let snippet = new CocSnippet(snippetString, position, nvim, resolver)
    await snippet.init(context, true)
    return snippet.text
  }
}

export function shouldCancel(token: CancellationToken, document: Document, delta: Position): boolean {
  if (token.isCancellationRequested) return false
  if (document.dirty) return true
  if (events.pumvisible && (delta.line != 0 || delta.character != 0)) return true
  return false
}
