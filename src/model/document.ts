import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, Disposable, Emitter, Event, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import events from '../events'
import { DidChangeTextDocumentParams, HighlightItem } from '../types'
import { diffLines, getChange } from '../util/diff'
import { disposeAll, getUri, wait } from '../util/index'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
import { isWindows } from '../util/platform'
import { emptyRange } from '../util/position'
import { byteIndex, byteLength, byteSlice, characterIndex } from '../util/string'
import { Chars } from './chars'
import { LinesTextDocument } from './textdocument'
const logger = require('../util/logger')('model-document')

export type LastChangeType = 'insert' | 'change' | 'delete'

export interface Env {
  readonly filetypeMap: { [index: string]: string }
  readonly isVim: boolean
  readonly isCygwin: boolean
}

export interface ChangeInfo {
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
  private mutex = new Mutex()
  private _version = 1
  private size = 0
  private nvim: Neovim
  private eol = true
  private variables: { [key: string]: any }
  // real current lines
  private lines: ReadonlyArray<string> = []
  private syncLines: ReadonlyArray<string> = []
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
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  public readonly onDocumentDetach: Event<number> = this._onDocumentDetach.event
  constructor(public readonly buffer: Buffer, private env: Env, private maxFileSize: number | null) {
    this.fireContentChanges = debounce(() => {
      this._fireContentChanges()
    }, 100)
    this.fetchContent = debounce(() => {
      this._fetchContent().logError()
    }, 100)
  }

  /**
   * Synchronize content
   */
  public get content(): string {
    return this.syncLines.join('\n') + (this.eol ? '\n' : '')
  }

  public get version(): number {
    return this._version
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
   * Map filetype for languageserver.
   */
  public convertFiletype(filetype: string): string {
    let map = this.env.filetypeMap
    if (filetype == 'javascript.jsx') return 'javascriptreact'
    if (filetype == 'typescript.jsx' || filetype == 'typescript.tsx') return 'typescriptreact'
    return map[filetype] || filetype
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
      this.syncLines = this.lines
      let res = await this.attach()
      if (!res) return false
      this._attached = true
    }
    this._filetype = this.convertFiletype(opts.filetype)
    this.setIskeyword(opts.iskeyword)
    if (token.isCancellationRequested) {
      this.detach()
      return false
    }
    return true
  }

  private async attach(): Promise<boolean> {
    let attached = await this.buffer.attach(true)
    if (!attached) return false
    this.buffer.listen('lines', this.onChange.bind(this), this.disposables)
    this.buffer.listen('detach', async buf => {
      this._onDocumentDetach.fire(buf.id)
    }, this.disposables)
    return true
  }

  private async onChange(buf: Buffer, tick: number, firstline: number, lastline: number, linedata: string[]): Promise<void> {
    if (buf.id !== this.bufnr || !this._attached || tick == null) return
    if (this.mutex.busy) return
    if (tick > this._changedtick) {
      this._changedtick = tick
      this.lines = [...this.lines.slice(0, firstline), ...linedata, ...this.lines.slice(lastline)]
      this.fireContentChanges()
    }
  }

  /**
   * Make sure current document synced correctly
   */
  public async checkDocument(): Promise<void> {
    let { buffer } = this
    let release = await this.mutex.acquire()
    this.fireContentChanges.clear()
    this._changedtick = await buffer.changedtick
    this.lines = await buffer.lines
    let changed = this._fireContentChanges()
    if (changed) await wait(30)
    release()
  }

  /**
   * Check if document changed after last synchronize
   */
  public get dirty(): boolean {
    if (this.lines === this.syncLines) return false
    return !equals(this.lines, this.syncLines)
  }

  private _fireContentChanges(): boolean {
    let { cursor, latestInsert } = events
    let { textDocument } = this
    try {
      let endOffset = null
      // consider cursor position.
      if (cursor && cursor.bufnr == this.bufnr) {
        endOffset = this.getEndOffset(cursor.lnum, cursor.col, cursor.insert)
        // FIXME there could be multiple characters inserted after cursor, but can't handle for now.
        if (latestInsert && latestInsert.bufnr == this.bufnr && Date.now() - latestInsert.timestamp < 200) {
          let line = this.getline(cursor.lnum - 1, true)
          let idx = characterIndex(line, cursor.col - 1)
          let next = line[idx]
          // latest insert character is next character, caused by extension like coc-pairs
          if (next != line[idx - 1] && next == latestInsert.character) {
            endOffset = endOffset - 1
          }
        }
      }
      let content = this.getDocumentContent()
      let change = getChange(textDocument.getText(), content, endOffset)
      if (change == null) return
      let start = textDocument.positionAt(change.start)
      let end = textDocument.positionAt(change.end)
      let original = textDocument.getText(Range.create(start, end))
      this._version = this._version + 1
      this.syncLines = this.lines
      let changes = [{
        range: { start, end },
        rangeLength: change.end - change.start,
        text: change.newText
      }]
      this._onDocumentChange.fire({
        bufnr: this.bufnr,
        original,
        textDocument: { version: this.version, uri: this.uri },
        contentChanges: changes
      })
      this._words = this.chars.matchKeywords(content)
      return true
    } catch (e) {
      logger.error(e.message)
    }
    return false
  }

  public async applyEdits(edits: TextEdit[]): Promise<void> {
    if (!Array.isArray(arguments[0]) && Array.isArray(arguments[1])) {
      edits = arguments[1]
    }
    if (edits.length == 0) return
    let current = this.getDocumentContent()
    let textDocument = TextDocument.create(this.uri, this.filetype, 1, current)
    // apply edits to current textDocument
    let applied = TextDocument.applyEdits(textDocument, edits)
    if (isWindows) {
      // avoid \r\n on Windows platform
      applied = applied.replace(/\r\n/g, '\n')
    }
    // could be equal sometimes
    if (current !== applied) {
      let newLines = (this.eol && applied.endsWith('\n') ? applied.slice(0, -1) : applied).split('\n')
      let d = diffLines(this.lines, newLines)
      let release = await this.mutex.acquire()
      try {
        let res = await this.nvim.call('coc#util#set_lines', [this.bufnr, d.replacement, d.start, d.end])
        this._changedtick = res.changedtick
        // can't wait vim sync buffer
        this.lines = newLines
        // res.lines
        this.fireContentChanges.clear()
        this._fireContentChanges()
        // could be user type during applyEdits.
        if (!equals(newLines, res.lines)) {
          process.nextTick(() => {
            this.lines = res.lines
            this.fireContentChanges.clear()
            this._fireContentChanges()
          })
        }
        release()
      } catch (e) {
        logger.error('Error on applyEdits: ', e)
        release()
      }
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
    let release = await this.mutex.acquire()
    try {
      let res = await this.nvim.call('coc#util#change_lines', [this.bufnr, filtered])
      if (res != null) {
        this.lines = newLines
        this._changedtick = res.changedtick
        this.fireContentChanges.clear()
        this._fireContentChanges()
        if (!equals(newLines, res.lines)) {
          process.nextTick(() => {
            this.lines = res.lines
            this.fireContentChanges.clear()
            this._fireContentChanges()
          })
        }
      }
      release()
    } catch (e) {
      release()
    }
  }

  /**
   * Force document synchronize and emit change event when necessary.
   */
  public forceSync(): void {
    if (this.mutex.busy) return
    this.fireContentChanges.clear()
    this._fireContentChanges()
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
  public get textDocument(): TextDocument {
    let { version, filetype, uri } = this
    return new LinesTextDocument(uri, filetype, version, this.syncLines, this.eol)
  }

  /**
   * Used by vim for fetch new lines.
   */
  private async _fetchContent(): Promise<void> {
    if (!this.env.isVim || !this._attached) return
    let { nvim, bufnr, changedtick } = this
    let release = await this.mutex.acquire()
    let o = await nvim.call('coc#util#get_buf_lines', [bufnr, changedtick])
    if (o && o.changedtick >= this._changedtick) {
      this._changedtick = o.changedtick
      this.lines = o.lines
      this.fireContentChanges.clear()
      this._fireContentChanges()
    }
    release()
  }

  /**
   * Get and synchronize change
   */
  public async patchChange(currentLine?: boolean): Promise<void> {
    if (!this._attached) return
    if (this.env.isVim) {
      if (currentLine) {
        let change = await this.nvim.call('coc#util#get_changeinfo', []) as ChangeInfo
        if (change.changedtick < this._changedtick) return
        let { lnum, line, changedtick } = change
        let newLines = this.lines.slice()
        this._changedtick = changedtick
        if (newLines[lnum - 1] == line) return
        newLines[lnum - 1] = line
        this.lines = newLines
        this.forceSync()
      } else {
        this.fetchContent.clear()
        await this._fetchContent()
      }
    } else {
      // changedtick from buffer events could be not latest. #3003
      this._changedtick = await this.buffer.getVar('changedtick') as number
      // we have latest lines aftet TextChange on neovim
      this.forceSync()
    }
  }

  /**
   * Get ranges of word in textDocument.
   */
  public getSymbolRanges(word: string): Range[] {
    this.forceSync()
    let res: Range[] = []
    let { textDocument } = this
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
  public addHighlights(items: HighlightItem[], hlGroup: string, range: Range): void {
    let { start, end } = range
    if (emptyRange(range)) return
    for (let line = start.line; line <= end.line; line++) {
      const text = this.getline(line, false)
      let colStart = line == start.line ? byteIndex(text, start.character) : 0
      let colEnd = line == end.line ? byteIndex(text, end.character) : global.Buffer.byteLength(text)
      if (colStart >= colEnd) continue
      items.push({ hlGroup, lnum: line, colStart, colEnd })
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
    return this.lines.slice(start, end)
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
   *
   * @internal
   */
  public setFiletype(filetype: string): void {
    this._filetype = this.convertFiletype(filetype)
    this._version = this._version + 1
  }

  /**
   * Change iskeyword option of document
   *
   * @internal
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

  public get attached(): boolean {
    return this._attached
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
    let doc = TextDocument.create(this.uri, this.filetype, 1, content)
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
