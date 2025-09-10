'use strict'
import { Buffer, Neovim, VimValue } from '@chemzqm/neovim'
import { Buffer as NodeBuffer } from 'buffer'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import events from '../events'
import { createLogger } from '../logger'
import { BufferOption, DidChangeTextDocumentParams, HighlightItem, HighlightItemOption, TextDocumentContentChange } from '../types'
import { toArray } from '../util/array'
import { isVim } from '../util/constants'
import { diffLines, getTextEdit } from '../util/diff'
import { disposeAll, getConditionValue, sha256, wait, waitNextTick } from '../util/index'
import { isUrl } from '../util/is'
import { debounce, path } from '../util/node'
import { equals, toObject } from '../util/object'
import { emptyRange } from '../util/position'
import { Disposable, Emitter, Event } from '../util/protocol'
import { byteIndex, byteLength, byteSlice, characterIndex, toText } from '../util/string'
import { applyEdits, filterSortEdits, getPositionFromEdits, getStartLine, mergeTextEdits, TextChangeItem, toTextChanges } from '../util/textedit'
import { Chars } from './chars'
import { LinesTextDocument } from './textdocument'
const logger = createLogger('document')
const MAX_EDITS = getConditionValue(200, 400)

export type LastChangeType = 'insert' | 'change' | 'delete'
export type VimBufferChange = [number, number, string[]]

export interface Env {
  readonly filetypeMap: { [index: string]: string }
  readonly isCygwin: boolean
}

export interface ChangeInfo {
  lnum: number
  line: string
  changedtick: number
}

export interface CursorAndCol {
  cursor?: [number, number]
  col?: number
}

const debounceTime = getConditionValue(150, 15)

// getText, positionAt, offsetAt
export default class Document {
  public buftype: string
  public isIgnored = false
  public chars: Chars
  private eol = true
  private _disposed = false
  private _attached = false
  private _notAttachReason = ''
  private _previewwindow = false
  private _winid = -1
  private _winids: number[] = []
  private _filetype: string
  private _bufname: string
  private _commandLine = false
  private _applying = false
  private _uri: string
  private _changedtick: number
  private variables: { [key: string]: VimValue }
  private disposables: Disposable[] = []
  private _textDocument: LinesTextDocument
  // real current lines
  private lines: ReadonlyArray<string> = []
  private _applyLines: ReadonlyArray<string>
  public fireContentChanges: (() => void) & { clear(): void } & { flush(): void }
  public fetchContent: (() => void) & { clear(): void } & { flush(): void }
  private _onDocumentChange = new Emitter<DidChangeTextDocumentParams>()
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  constructor(
    public readonly buffer: Buffer,
    private nvim: Neovim,
    filetype: string,
    opts: BufferOption
  ) {
    this.fireContentChanges = debounce(() => {
      this._fireContentChanges()
    }, debounceTime)
    this.init(filetype, opts)
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
  /**
   * Buffer number
   */
  public get bufnr(): number {
    return this.buffer.id
  }

  public get bufname(): string {
    return this._bufname
  }

  public get filetype(): string {
    return this._filetype
  }

  public get uri(): string {
    return this._uri
  }

  public get isCommandLine(): boolean {
    return this._commandLine
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
   */
  public get winid(): number {
    return this._winid
  }

  public get winids(): ReadonlyArray<number> {
    return this._winids
  }

  /**
   * Returns if current document is opened with previewwindow
   * @deprecated
   */
  public get previewwindow(): boolean {
    return this._previewwindow
  }

  /**
   * Initialize document model.
   */
  private init(filetype: string, opts: BufferOption): void {
    let buftype = this.buftype = opts.buftype
    this._bufname = opts.bufname
    this._commandLine = opts.commandline === 1
    this._previewwindow = !!opts.previewwindow
    this._winid = opts.winid
    this._winids = toArray(opts.winids)
    this.variables = toObject(opts.variables)
    this._changedtick = opts.changedtick
    this.eol = opts.eol == 1
    this._uri = getUri(opts.fullpath, this.bufnr, buftype)
    if (Array.isArray(opts.lines)) {
      this.lines = opts.lines.map(line => toText(line))
      this._attached = true
      this.attach()
    } else {
      this.lines = []
      this._notAttachReason = getNotAttachReason(buftype, this.variables[`coc_enabled`] as number, opts.size)
    }
    this._filetype = filetype
    this.setIskeyword(opts.iskeyword, opts.lisp)
    this.createTextDocument(1, this.lines)
  }

  public get notAttachReason(): string {
    return this._notAttachReason
  }

  public attach(): void {
    let lines = this.lines
    const { bufnr } = this
    this.buffer.attach(true).then(res => {
      if (!res) fireDetach(this.bufnr)
    }, _e => {
      fireDetach(this.bufnr)
    })
    const onLinesChange = (_buf: number | Buffer, tick: number | null, firstline: number, lastline: number, linedata: string[]) => {
      if (tick && tick > this._changedtick) {
        this._changedtick = tick
        lines = [...lines.slice(0, firstline), ...linedata, ...(lastline < 0 ? [] : lines.slice(lastline))]
        if (lines.length == 0) lines = ['']
        if (this._applying) {
          this._applyLines = lines
          return
        }
        this.lines = lines
        fireLinesChanged(bufnr)
        if (events.completing) return
        this.fireContentChanges()
      }
    }
    if (isVim) {
      this.buffer.listen('vim_lines', onLinesChange, this.disposables)
    } else {
      this.buffer.listen('lines', onLinesChange, this.disposables)
      this.buffer.listen('detach', () => {
        fireDetach(this.bufnr)
      }, this.disposables)
    }
  }

  /**
   * Check if document changed after last synchronize
   */
  public get dirty(): boolean {
    // if (this.lines === this.syncLines) return false
    // return !equals(this.lines, this.syncLines)
    return this.lines !== this.syncLines
  }

  public get hasChanged(): boolean {
    if (!this.dirty) return false
    return !equals(this.lines, this.syncLines)
  }

  /**
   * Cursor position if document is current document
   */
  public get cursor(): Position | undefined {
    let { cursor } = events
    if (cursor.bufnr !== this.bufnr) return undefined
    let content = toText(this.lines[cursor.lnum - 1])
    return Position.create(cursor.lnum - 1, characterIndex(content, cursor.col - 1))
  }

  private _fireContentChanges(edit?: TextEdit): void {
    if (this.lines === this.syncLines) return
    let textDocument = this._textDocument
    let changes: TextDocumentContentChange[] = []
    if (!edit) edit = getTextEdit(textDocument.lines, this.lines, this.cursor, events.cursor.insert)
    let original: string
    if (edit) {
      original = textDocument.getText(edit.range)
      changes.push({ range: edit.range, text: edit.newText, rangeLength: original.length })
    } else {
      original = ''
    }
    let created = this.createTextDocument(this.version + (edit ? 1 : 0), this.lines)
    this._onDocumentChange.fire(Object.freeze({
      bufnr: this.bufnr,
      original,
      originalLines: textDocument.lines,
      textDocument: { version: created.version, uri: this.uri },
      document: created,
      contentChanges: changes
    }))
  }

  public async applyEdits(edits: TextEdit[], joinUndo = false, move: boolean | Position = false): Promise<TextEdit | undefined> {
    if (Array.isArray(arguments[1])) edits = arguments[1]
    if (!this._attached || edits.length === 0) return
    const { bufnr } = this
    this._forceSync()
    let textDocument = this.textDocument
    edits = filterSortEdits(textDocument, edits)
    // apply edits to current textDocument
    let newLines = applyEdits(textDocument, edits)
    if (!newLines) return
    let lines = textDocument.lines
    let changed = diffLines(lines, newLines, getStartLine(edits[0]))
    // append new lines
    let isAppend = changed.start === changed.end && changed.start === lines.length
    let original = lines.slice(changed.start, changed.end)
    let changes: TextChangeItem[] = []
    // Avoid too many buf_set_text cause nvim slow.
    // Not used when insert or delete lines.
    if (edits.length <= MAX_EDITS && changed.start !== changed.end && changed.replacement.length > 0) {
      changes = toTextChanges(lines, edits)
    }
    const { cursor, col } = this.getCursorAndCol(move, edits, newLines)
    this.nvim.pauseNotification()
    if (joinUndo) this.nvim.command(`if bufnr('%') == ${bufnr} | undojoin | endif`, true)
    if (isAppend) {
      this.buffer.setLines(changed.replacement, { start: -1, end: -1 }, true)
    } else {
      this.nvim.call('coc#ui#set_lines', [
        this.bufnr,
        this._changedtick,
        original,
        changed.replacement,
        changed.start,
        changed.end,
        changes,
        cursor,
        col,
        lines.length
      ], true)
    }
    this._applying = true
    void this.nvim.resumeNotification(true, true)
    this.lines = newLines
    await waitNextTick()
    fireLinesChanged(bufnr)
    let textEdit = edits.length == 1 ? edits[0] : mergeTextEdits(edits, lines, newLines)
    this.fireContentChanges.clear()
    this._fireContentChanges(textEdit)
    let range = Range.create(changed.start, 0, changed.start + changed.replacement.length, 0)
    return TextEdit.replace(range, original.join('\n') + (original.length > 0 ? '\n' : ''))
  }

  public onTextChange(): void {
    let { bufnr } = this
    if (this._applying) {
      this._applying = false
      if (this._applyLines != null && !equals(this._applyLines, this.textDocument.lines)) {
        this.lines = this._applyLines
        this._applyLines = undefined
        fireLinesChanged(bufnr)
        this.fireContentChanges()
      }
    }
  }

  private getCursorAndCol(move: boolean | Position, edits: TextEdit[], newLines: ReadonlyArray<string>): CursorAndCol {
    if (!move) return {}
    let pos = Position.is(move) ? move : this.cursor
    if (pos) {
      let position = getPositionFromEdits(pos, edits)
      if (!equals(pos, position)) {
        let content = toText(newLines[position.line])
        let column = byteIndex(content, position.character) + 1
        return {
          cursor: [position.line + 1, column],
          col: byteIndex(this.lines[pos.line], pos.character) + 1
        }
      }
    }
    return {}
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
    this.nvim.call('coc#ui#change_lines', [this.bufnr, filtered], true)
    this.nvim.redrawVim()
    this.lines = newLines
    await waitNextTick()
    fireLinesChanged(this.bufnr)
    this._forceSync()
  }

  public _forceSync(): void {
    if (!this._attached) return
    this.fireContentChanges.clear()
    this._fireContentChanges()
  }

  public forceSync(): void {
    // may cause bugs, prevent extensions use it.
    if (global.__TEST__) {
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

  public getStartWord(text: string): string {
    let i = 0
    for (; i < text.length; i++) {
      if (!this.chars.isKeywordChar(text[i])) break
    }
    return text.slice(0, i)
  }

  /**
   * Current word for replacement
   */
  public getWordRangeAtPosition(position: Position, extraChars?: string, current = true): Range | null {
    let chars = this.chars
    if (extraChars && extraChars.length) {
      chars = this.chars.clone()
      for (let ch of extraChars) {
        chars.addKeyword(ch)
      }
    }
    let line = this.getline(position.line, current)
    let ch = line[position.character]
    if (ch == null || !chars.isKeywordChar(ch)) return null
    let start = position.character
    let end = position.character + 1
    while (start >= 0) {
      let ch = line[start - 1]
      if (!ch || !chars.isKeywordChar(ch)) break
      start = start - 1
    }
    while (end <= line.length) {
      let ch = line[end]
      if (!ch || !chars.isKeywordChar(ch)) break
      end = end + 1
    }
    return Range.create(position.line, start, position.line, end)
  }

  private createTextDocument(version: number, lines: ReadonlyArray<string>): LinesTextDocument {
    let { uri, languageId, eol } = this
    let textDocument = this._textDocument = new LinesTextDocument(uri, languageId, version, lines, this.bufnr, eol)
    return textDocument
  }

  /**
   * Get ranges of word in textDocument.
   */
  public getSymbolRanges(word: string): Range[] {
    let { version, languageId, uri } = this
    let textDocument = new LinesTextDocument(uri, languageId, version, this.lines, this.bufnr, this.eol)
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
    if (!line) return 0
    let { character } = position
    let start = line.slice(0, character)
    let col = byteLength(start)
    let { chars } = this
    for (let i = start.length - 1; i >= 0; i--) {
      let c = start[i]
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
      let colEnd = line == end.line ? byteIndex(text, end.character) : NodeBuffer.byteLength(text)
      if (colStart >= colEnd) continue
      items.push(Object.assign({ hlGroup, lnum: line, colStart, colEnd }, opts))
    }
  }

  /**
   * Line content 0 based line
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
  public getVar<T extends VimValue>(key: string, defaultValue?: T): T {
    let val = this.variables[`coc_${key}`] as T
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
   * Recreate document with new filetype.
   */
  public setFiletype(filetype: string): void {
    this._filetype = filetype
    let lines = this.lines
    this._textDocument = new LinesTextDocument(this.uri, this.languageId, 1, lines, this.bufnr, this.eol)
  }

  /**
   * Change iskeyword option of document
   */
  public setIskeyword(iskeyword: string, lisp?: number): void {
    let chars = this.chars = new Chars(iskeyword)
    let additional = this.getVar<string[]>('additional_keywords', [])
    if (lisp) chars.addKeyword('-')
    if (additional && Array.isArray(additional)) {
      for (let ch of additional) {
        chars.addKeyword(ch)
      }
    }
  }

  /**
   * Detach document.
   */
  public detach(): void {
    disposeAll(this.disposables)
    if (this._disposed) return
    this._disposed = true
    this._attached = false
    this.lines = []
    this.fireContentChanges.clear()
    this._onDocumentChange.dispose()
  }

  /**
   * Synchronize latest document content
   */
  public async synchronize(): Promise<void> {
    if (!this.attached) return
    let { changedtick } = this
    await this.patchChange()
    if (changedtick != this.changedtick) {
      await wait(30)
    }
  }

  /**
   * Synchronize buffer change
   */
  public async patchChange(): Promise<void> {
    if (!this._attached) return
    // changedtick from buffer events could be not latest. #3003
    this._changedtick = await this.nvim.call('coc#util#get_changedtick', [this.bufnr]) as number
    this._forceSync()
  }

  public getSha256(): string {
    return sha256(this.lines.join('\n'))
  }

  public async fetchLines(): Promise<void> {
    let lines = await this.nvim.call('getbufline', [this.bufnr, 1, '$']) as ReadonlyArray<string>
    this.lines = lines
    fireLinesChanged(this.bufnr)
    this.fireContentChanges()
    logger.error(`Buffer ${this.bufnr} not synchronized on vim9, consider send bug report!`)
  }
}

function fireDetach(bufnr: number): void {
  void events.fire('BufDetach', [bufnr])
}

function fireLinesChanged(bufnr: number): void {
  void events.fire('LinesChanged', [bufnr])
}

export function getUri(fullpath: string, id: number, buftype: string): string {
  if (!fullpath) return `untitled:${id}`
  if (path.isAbsolute(fullpath)) return URI.file(path.normalize(fullpath)).toString()
  if (isUrl(fullpath)) return URI.parse(fullpath).toString()
  if (buftype != '') return `${buftype}:${id}`
  return `unknown:${id}`
}

export function getNotAttachReason(buftype: string, enabled: number | undefined, size: number): string {
  if (!['', 'acwrite'].includes(buftype)) {
    return `not a normal buffer, buftype "${buftype}"`
  }
  if (enabled === 0) {
    return `b:coc_enabled = 0`
  }
  return `buffer size ${size} exceed coc.preferences.maxFileSize`
}
