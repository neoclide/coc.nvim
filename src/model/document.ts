import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, Disposable, Emitter, Event, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import events from '../events'
import { DidChangeTextDocumentParams, HighlightItem, HighlightItemOption } from '../types'
import { diffLines, getChange } from '../util/diff'
import { disposeAll, getUri, wait, waitNextTick } from '../util/index'
import { equals } from '../util/object'
import { emptyRange } from '../util/position'
import { mergeSort, getWellformedEdit } from '../util/textedit'
import { byteIndex, byteLength, byteSlice } from '../util/string'
import { Chars } from './chars'
import { LinesTextDocument } from './textdocument'
const logger = require('../util/logger')('model-document')

export type LastChangeType = 'insert' | 'change' | 'delete'

/**
 * newText, startLine, startCol, endLine, endCol
 */
export type TextChangeItem = [string[], number, number, number, number]

export interface Env {
  readonly filetypeMap: { [index: string]: string }
  readonly isVim: boolean
  readonly isCygwin: boolean
}

export interface ChangeInfo {
  bufnr: number
  lnum: number
  line: string
  changedtick: number
}

export interface BufferOption {
  eol: number
  size: number
  winid: number
  previewwindow: boolean
  variables: { [key: string]: any }
  bufname: string
  fullpath: string
  buftype: string
  filetype: string
  iskeyword: string
  changedtick: number
  lines: string[]
}

// getText, positionAt, offsetAt
export default class Document {
  public buftype: string
  public isIgnored = false
  public chars: Chars
  public fireContentChanges: Function & { clear(): void }
  public fetchContent: Function & { clear(): void }
  private size = 0
  private nvim: Neovim
  private eol = true
  private variables: { [key: string]: any }
  // real current lines
  private lines: ReadonlyArray<string> = []
  private _attached = false
  private _previewwindow = false
  private _winid = -1
  private _filetype: string
  private _uri: string
  private _changedtick: number
  private _words: string[] = []
  private _onDocumentChange = new Emitter<DidChangeTextDocumentParams>()
  private _onDocumentDetach = new Emitter<number>()
  private disposables: Disposable[] = []
  private _textDocument: LinesTextDocument
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  public readonly onDocumentDetach: Event<number> = this._onDocumentDetach.event
  constructor(public readonly buffer: Buffer, private env: Env, private maxFileSize: number | null) {
    this.fireContentChanges = debounce(() => {
      this._fireContentChanges()
    }, 300)
    this.fetchContent = debounce(() => {
      void this._fetchContent()
    }, 100)
  }

  /**
   * Synchronize content
   */
  public get content(): string {
    return this.syncLines.join('\n') + (this.eol ? '\n' : '')
  }

  public get attached(): boolean {
    return this._attached
  }

  /**
   * Buffer number
   */
  public get bufnr(): number {
    return this.buffer.id
  }

  public get filetype(): string {
    return this._filetype
  }

  public get uri(): string {
    return this._uri
  }
  /**
   * Check if current document should be attached for changes.
   *
   * Currently only attach for empty and `acwrite` buftype.
   */
  public get shouldAttach(): boolean {
    let { buftype, maxFileSize } = this
    if (!this.getVar('enabled', true)) return false
    if (this.uri.endsWith('%5BCommand%20Line%5D')) return true
    // too big
    if (this.size == -2) return false
    if (maxFileSize && this.size > maxFileSize) return false
    return buftype == '' || buftype == 'acwrite'
  }

  public get isCommandLine(): boolean {
    return this.uri && this.uri.endsWith('%5BCommand%20Line%5D')
  }

  public get enabled(): boolean {
    return this.getVar('enabled', true)
  }

  /**
   * All words, extracted by `iskeyword` option.
   */
  public get words(): string[] {
    return this._words
  }

  /**
   * LanguageId of TextDocument, main filetype are used for combined filetypes
   * with '.'
   */
  public get languageId(): string {
    let { _filetype } = this
    return _filetype.includes('.') ? _filetype.match(/(.*?)\./)[1] : _filetype
  }

  /**
   * Map filetype for languageserver.
   */
  public convertFiletype(filetype: string): string {
    switch (filetype) {
      case 'javascript.jsx':
        return 'javascriptreact'
      case 'typescript.jsx':
      case 'typescript.tsx':
        return 'typescriptreact'
      case 'tex':
        // Vim filetype 'tex' means LaTeX, which has LSP language ID 'latex'
        return 'latex'
      default: {
        let map = this.env.filetypeMap
        return map[filetype] || filetype
      }
    }
  }

  /**
   * Get current buffer changedtick.
   */
  public get changedtick(): number {
    return this._changedtick
  }

  /**
   * Scheme of document.
   */
  public get schema(): string {
    return URI.parse(this.uri).scheme
  }

  /**
   * Line count of current buffer.
   */
  public get lineCount(): number {
    return this.lines.length
  }

  /**
   * Window ID when buffer create, could be -1 when no window associated.
   *
   * @deprecated could be wrong.
   */
  public get winid(): number {
    return this._winid
  }

  /**
   * Returns if current document is opended with previewwindow
   *
   * @deprecated
   */
  public get previewwindow(): boolean {
    return this._previewwindow
  }

  /**
   * Initialize document model.
   *
   * @internal
   */
  public async init(nvim: Neovim, token: CancellationToken): Promise<boolean> {
    this.nvim = nvim
    let opts: BufferOption = await nvim.call('coc#util#get_bufoptions', [this.bufnr, this.maxFileSize])
    if (opts == null) return false
    let buftype = this.buftype = opts.buftype
    this._previewwindow = opts.previewwindow
    this._winid = opts.winid
    this.size = typeof opts.size == 'number' ? opts.size : 0
    this.variables = opts.variables || {}
    this._changedtick = opts.changedtick
    this.eol = opts.eol == 1
    this._uri = getUri(opts.fullpath, this.bufnr, buftype, this.env.isCygwin)
    if (token.isCancellationRequested) return false
    if (this.shouldAttach) {
      this.lines = opts.lines
      let res = await this.attach()
      if (!res) return false
      this._attached = true
    }
    this._filetype = this.convertFiletype(opts.filetype)
    this.setIskeyword(opts.iskeyword)
    this.createTextDocument(1, this.lines)
    if (token.isCancellationRequested) {
      this.detach()
      return false
    }
    return true
  }

  private async attach(): Promise<boolean> {
    let attached = await this.buffer.attach(true)
    if (!attached) return false
    let lines = this.lines
    this.buffer.listen('lines', (buf: Buffer, tick: number, firstline: number, lastline: number, linedata: string[]) => {
      if (buf.id !== this.bufnr || !this._attached || tick == null) return
      if (tick > this._changedtick) {
        this._changedtick = tick
        lines = [...lines.slice(0, firstline), ...linedata, ...lines.slice(lastline)]
        this.lines = lines
        this.fireContentChanges()
      }
    }, this.disposables)
    this.buffer.listen('detach', async buf => {
      lines = []
      this._onDocumentDetach.fire(buf.id)
    }, this.disposables)
    return true
  }

  /**
   * Check if document changed after last synchronize
   */
  public get dirty(): boolean {
    if (this.lines === this.syncLines) return false
    return !equals(this.lines, this.syncLines)
  }

  private _fireContentChanges(): void {
    let { cursor } = events
    if (!this.dirty) return
    let textDocument = this._textDocument
    let endOffset = null
    // consider cursor position.
    if (cursor && cursor.bufnr == this.bufnr) {
      endOffset = this.getEndOffset(cursor.lnum, cursor.col, cursor.insert)
    }
    let content = this.getDocumentContent()
    let change = getChange(textDocument.getText(), content, endOffset)
    if (change == null) return
    let start = textDocument.positionAt(change.start)
    let end = textDocument.positionAt(change.end)
    let original = textDocument.getText(Range.create(start, end))
    this.createTextDocument(this.version + 1, this.lines)
    let changes = [{
      range: { start, end },
      rangeLength: change.end - change.start,
      text: change.newText
    }]
    this._onDocumentChange.fire({
      bufnr: this.bufnr,
      original,
      originalLines: textDocument.lines,
      textDocument: { version: this.version, uri: this.uri },
      contentChanges: changes
    })
    this._words = this.chars.matchKeywords(content)
  }

  public async applyEdits(edits: TextEdit[]): Promise<void> {
    if (!Array.isArray(arguments[0]) && Array.isArray(arguments[1])) {
      edits = arguments[1]
    }
    if (edits.length == 0) return
    let textDocument = TextDocument.create(this.uri, this.languageId, 1, this.getDocumentContent())
    // apply edits to current textDocument
    let applied = TextDocument.applyEdits(textDocument, edits)
    let content: string
    if (this.eol) {
      if (applied.endsWith('\r\n')) {
        content = applied.slice(0, -2)
      } else {
        content = applied.endsWith('\n') ? applied.slice(0, -1) : applied
      }
    } else {
      content = applied
    }
    let lines = this.lines
    let newLines = content.split(/\r?\n/)
    // could be equal sometimes
    if (!equals(lines, newLines)) {
      let lnums = edits.map(o => o.range.start.line)
      let d = diffLines(lines, newLines, Math.min.apply(null, lnums))
      let original = lines.slice(d.start, d.end)
      let changes: TextChangeItem[] = []
      let total = lines.length
      // avoid out of range and lines replacement.
      if (this.nvim.hasFunction('nvim_buf_set_text')
        && edits.every(o => validRange(o.range, total))) {
        // keep the extmarks
        let sortedEdits = mergeSort(edits.map(getWellformedEdit), (a, b) => {
          let diff = a.range.start.line - b.range.start.line
          if (diff === 0) {
            return a.range.start.character - b.range.start.character
          }
          return diff
        })
        // console.log(JSON.stringify(sortedEdits, null, 2))
        changes = sortedEdits.reverse().map(o => {
          let r = o.range
          let sl = this.getline(r.start.line)
          let sc = byteLength(sl.slice(0, r.start.character))
          let el = r.end.line == r.start.line ? sl : this.getline(r.end.line)
          let ec = byteLength(el.slice(0, r.end.character))
          return [o.newText.split(/\r?\n/), r.start.line, sc, r.end.line, ec]
        })
      }
      this.nvim.call('coc#util#set_lines', [this.bufnr, this._changedtick, original, d.replacement, d.start, d.end, changes], true)
      if (this.env.isVim) this.nvim.command('redraw', true)
      await waitNextTick(() => {
        // can't wait vim sync buffer
        this.lines = newLines
        this._forceSync()
      })
    }
  }

  public async changeLines(lines: [number, string][]): Promise<void> {
    let filtered: [number, string][] = []
    let newLines = this.lines.slice()
    for (let [lnum, text] of lines) {
      if (newLines[lnum] != text) {
        filtered.push([lnum, text])
        newLines[lnum] = text
      }
    }
    if (!filtered.length) return
    this.nvim.call('coc#util#change_lines', [this.bufnr, filtered], true)
    this.nvim.redrawVim()
    this.lines = newLines
    this._forceSync()
  }

  public _forceSync(): void {
    this.fireContentChanges.clear()
    this._fireContentChanges()
  }

  public forceSync(): void {
    // may cause bugs, prevent extensions use it.
    if (global.hasOwnProperty('__TEST__')) {
      this._forceSync()
    }
  }

  /**
   * Get offset from lnum & col
   */
  public getOffset(lnum: number, col: number): number {
    return this.textDocument.offsetAt({
      line: lnum - 1,
      character: col
    })
  }

  /**
   * Check string is word.
   */
  public isWord(word: string): boolean {
    return this.chars.isKeyword(word)
  }

  /**
   * Generate more words by split word with `-`
   */
  public getMoreWords(): string[] {
    let res = []
    let { words, chars } = this
    if (!chars.isKeywordChar('-')) return res
    for (let word of words) {
      word = word.replace(/^-+/, '')
      if (word.includes('-')) {
        let parts = word.split('-')
        for (let part of parts) {
          if (
            part.length > 2 &&
            !res.includes(part) &&
            !words.includes(part)
          ) {
            res.push(part)
          }
        }
      }
    }
    return res
  }

  /**
   * Current word for replacement
   */
  public getWordRangeAtPosition(position: Position, extraChars?: string, current = true): Range | null {
    let chars = this.chars.clone()
    if (extraChars && extraChars.length) {
      for (let ch of extraChars) {
        chars.addKeyword(ch)
      }
    }
    let line = this.getline(position.line, current)
    if (line.length == 0 || position.character >= line.length) return null
    if (!chars.isKeywordChar(line[position.character])) return null
    let start = position.character
    let end = position.character + 1
    if (!chars.isKeywordChar(line[start])) {
      return Range.create(position, { line: position.line, character: position.character + 1 })
    }
    while (start >= 0) {
      let ch = line[start - 1]
      if (!ch || !chars.isKeyword(ch)) break
      start = start - 1
    }
    while (end <= line.length) {
      let ch = line[end]
      if (!ch || !chars.isKeywordChar(ch)) break
      end = end + 1
    }
    return Range.create(position.line, start, position.line, end)
  }

  /**
   * Synchronized textDocument.
   */
  public get textDocument(): LinesTextDocument {
    return this._textDocument
  }

  private get syncLines(): ReadonlyArray<string> {
    return this._textDocument.lines
  }

  public get version(): number {
    return this._textDocument.version
  }

  private createTextDocument(version: number, lines: ReadonlyArray<string>): void {
    let { uri, languageId, eol } = this
    this._textDocument = new LinesTextDocument(uri, languageId, version, lines, eol)
  }

  /**
   * Used by vim for fetch new lines.
   */
  private async _fetchContent(sync?: boolean): Promise<void> {
    if (!this.env.isVim || !this._attached) return
    let { nvim, bufnr, changedtick } = this
    let o = await nvim.call('coc#util#get_buf_lines', [bufnr, changedtick])
    if (o) {
      this._changedtick = o.changedtick
      this.lines = o.lines
      if (sync) {
        this._forceSync()
      } else {
        this.fireContentChanges()
      }
    } else if (sync) {
      this._forceSync()
    }
  }

  /**
   * Get and synchronize change
   */
  public async patchChange(currentLine?: boolean): Promise<void> {
    if (!this._attached) return
    if (this.env.isVim) {
      if (currentLine) {
        let change = await this.nvim.call('coc#util#get_changeinfo', []) as ChangeInfo
        if (change.bufnr !== this.bufnr) return
        if (change.changedtick < this._changedtick) {
          this._forceSync()
          return
        }
        let { lnum, line, changedtick } = change
        let curr = this.getline(lnum - 1)
        this._changedtick = changedtick
        if (curr == line) {
          this._forceSync()
        } else {
          let newLines = this.lines.slice()
          newLines[lnum - 1] = line
          this.lines = newLines
          this._forceSync()
        }
      } else {
        this.fetchContent.clear()
        await this._fetchContent(true)
      }
    } else {
      // changedtick from buffer events could be not latest. #3003
      this._changedtick = await this.buffer.getVar('changedtick') as number
      // we have latest lines aftet TextChange on neovim
      this._forceSync()
    }
  }

  /**
   * Get ranges of word in textDocument.
   */
  public getSymbolRanges(word: string): Range[] {
    let { version, filetype, uri } = this
    let textDocument = new LinesTextDocument(uri, filetype, version, this.lines, this.eol)
    let res: Range[] = []
    let content = textDocument.getText()
    let str = ''
    for (let i = 0, l = content.length; i < l; i++) {
      let ch = content[i]
      if ('-' == ch && str.length == 0) {
        continue
      }
      let isKeyword = this.chars.isKeywordChar(ch)
      if (isKeyword) {
        str = str + ch
      }
      if (str.length > 0 && !isKeyword && str == word) {
        res.push(Range.create(textDocument.positionAt(i - str.length), textDocument.positionAt(i)))
      }
      if (!isKeyword) {
        str = ''
      }
    }
    return res
  }

  /**
   * Adjust col with new valid character before position.
   */
  public fixStartcol(position: Position, valids: string[]): number {
    let line = this.getline(position.line)
    if (!line) return null
    let { character } = position
    let start = line.slice(0, character)
    let col = byteLength(start)
    let { chars } = this
    for (let i = start.length - 1; i >= 0; i--) {
      let c = start[i]
      if (c == ' ') break
      if (!chars.isKeywordChar(c) && !valids.includes(c)) {
        break
      }
      col = col - byteLength(c)
    }
    return col
  }

  /**
   * Add vim highlight items from highlight group and range.
   * Synchronized lines are used for calculate cols.
   */
  public addHighlights(items: HighlightItem[], hlGroup: string, range: Range, opts: HighlightItemOption = {}): void {
    let { start, end } = range
    if (emptyRange(range)) return
    for (let line = start.line; line <= end.line; line++) {
      const text = this.getline(line, false)
      let colStart = line == start.line ? byteIndex(text, start.character) : 0
      let colEnd = line == end.line ? byteIndex(text, end.character) : global.Buffer.byteLength(text)
      if (colStart >= colEnd) continue
      items.push(Object.assign({ hlGroup, lnum: line, colStart, colEnd }, opts))
    }
  }

  /**
   * Real current line
   */
  public getline(line: number, current = true): string {
    if (current) return this.lines[line] || ''
    return this.syncLines[line] || ''
  }

  /**
   * Get lines, zero indexed, end exclude.
   */
  public getLines(start?: number, end?: number): string[] {
    return this.lines.slice(start ?? 0, end ?? this.lines.length)
  }

  /**
   * Get current content text.
   */
  public getDocumentContent(): string {
    let content = this.lines.join('\n')
    return this.eol ? content + '\n' : content
  }

  /**
   * Get variable value by key, defined by `b:coc_{key}`
   */
  public getVar<T>(key: string, defaultValue?: T): T {
    let val = this.variables[`coc_${key}`]
    return val === undefined ? defaultValue : val
  }

  /**
   * Get position from lnum & col
   */
  public getPosition(lnum: number, col: number): Position {
    let line = this.getline(lnum - 1)
    if (!line || col == 0) return { line: lnum - 1, character: 0 }
    let pre = byteSlice(line, 0, col - 1)
    return { line: lnum - 1, character: pre.length }
  }

  /**
   * Get end offset from cursor position.
   * For normal mode, use offset - 1 when possible
   */
  public getEndOffset(lnum: number, col: number, insert: boolean): number {
    let total = 0
    let len = this.lines.length
    for (let i = lnum - 1; i < len; i++) {
      let line = this.lines[i]
      let l = line.length
      if (i == lnum - 1 && l != 0) {
        // current
        let buf = global.Buffer.from(line, 'utf8')
        let isEnd = buf.byteLength <= col - 1
        if (!isEnd) {
          total = total + buf.slice(col - 1, buf.length).toString('utf8').length
          if (!insert) total = total - 1
        }
      } else {
        total = total + l
      }
      if (!this.eol && i == len - 1) break
      total = total + 1
    }
    return total
  }

  /**
   * Recreate document with new filetype.
   */
  public setFiletype(filetype: string): void {
    this._filetype = this.convertFiletype(filetype)
    let lines = this._textDocument.lines
    this._textDocument = new LinesTextDocument(this.uri, this.languageId, 1, lines, this.eol)
  }

  /**
   * Change iskeyword option of document
   */
  public setIskeyword(iskeyword: string): void {
    let chars = this.chars = new Chars(iskeyword)
    let additional = this.getVar<string[]>('additional_keywords', [])
    if (additional && Array.isArray(additional)) {
      for (let ch of additional) {
        chars.addKeyword(ch)
      }
    }
    let lines = this.lines.length > 30000 ? this.lines.slice(0, 30000) : this.lines
    // TODO not parse words
    this._words = this.chars.matchKeywords(lines.join('\n'))
  }

  /**
   * Detach document.
   *
   * @internal
   */
  public detach(): void {
    this._attached = false
    disposeAll(this.disposables)
    this.disposables = []
    this.fetchContent.clear()
    this.fireContentChanges.clear()
    this._onDocumentChange.dispose()
    this._onDocumentDetach.dispose()
  }

  /**
   * Synchronize latest document content
   */
  public async synchronize(): Promise<void> {
    let { changedtick } = this
    await this.patchChange()
    if (changedtick != this.changedtick) {
      await wait(50)
    }
  }

  /**
   * Get localify bonus map.
   *
   * @internal
   */
  public getLocalifyBonus(sp: Position, ep: Position): Map<string, number> {
    let res: Map<string, number> = new Map()
    let { chars } = this
    let startLine = Math.max(0, sp.line - 100)
    let endLine = Math.min(this.lineCount, sp.line + 100)
    let content = this.lines.slice(startLine, endLine).join('\n')
    sp = Position.create(sp.line - startLine, sp.character)
    ep = Position.create(ep.line - startLine, ep.character)
    let doc = TextDocument.create(this.uri, this.languageId, 1, content)
    let headCount = doc.offsetAt(sp)
    let len = content.length
    let tailCount = len - doc.offsetAt(ep)
    let start = 0
    let preKeyword = false
    for (let i = 0; i < headCount; i++) {
      let iskeyword = chars.isKeyword(content[i])
      if (!preKeyword && iskeyword) {
        start = i
      } else if (preKeyword && (!iskeyword || i == headCount - 1)) {
        if (i - start > 1) {
          let str = content.slice(start, i)
          res.set(str, i / headCount)
        }
      }
      preKeyword = iskeyword
    }
    start = len - tailCount
    preKeyword = false
    for (let i = start; i < content.length; i++) {
      let iskeyword = chars.isKeyword(content[i])
      if (!preKeyword && iskeyword) {
        start = i
      } else if (preKeyword && (!iskeyword || i == len - 1)) {
        if (i - start > 1) {
          let end = i == len - 1 ? i + 1 : i
          let str = content.slice(start, end)
          let score = res.get(str) || 0
          res.set(str, Math.max(score, (len - i + (end - start)) / tailCount))
        }
      }
      preKeyword = iskeyword
    }
    return res
  }
}

function validRange(range: Range, total: number): boolean {
  if (range.end.line >= total) return false
  if (range.start.line < 0 || range.start.character < 0) return false
  return true
}
