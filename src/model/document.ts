import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, Disposable, Emitter, Event, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import events from '../events'
import { BufferOption, ChangeInfo, DidChangeTextDocumentParams, Env } from '../types'
import { distinct, group } from '../util/array'
import { diffLines, getChange } from '../util/diff'
import { isGitIgnored } from '../util/fs'
import { disposeAll, getUri } from '../util/index'
import { comparePosition } from '../util/position'
import { byteIndex, byteLength, byteSlice } from '../util/string'
import { Chars } from './chars'
const logger = require('../util/logger')('model-document')

export type LastChangeType = 'insert' | 'change' | 'delete'

// wrapper class of TextDocument
export default class Document {
  public buftype: string
  public isIgnored = false
  public chars: Chars
  public textDocument: TextDocument
  public fireContentChanges: Function & { clear(): void }
  public fetchContent: Function & { clear(): void }
  // start id for matchaddpos
  private colorId = 1080
  private size = 0
  private nvim: Neovim
  private eol = true
  private variables: { [key: string]: any }
  // real current lines
  private lines: string[] = []
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
  constructor(
    public readonly buffer: Buffer,
    private env: Env,
    private maxFileSize: number | null) {
    this.fireContentChanges = debounce(() => {
      this._fireContentChanges()
    }, 200)
    this.fetchContent = debounce(() => {
      this._fetchContent().logError()
    }, 100)
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
    let { buffer } = this
    let opts: BufferOption = await nvim.call('coc#util#get_bufoptions', buffer.id)
    if (opts == null) return false
    let buftype = this.buftype = opts.buftype
    this._previewwindow = opts.previewwindow
    this._winid = opts.winid
    this.size = typeof opts.size == 'number' ? opts.size : 0
    this.variables = opts.variables
    this._changedtick = opts.changedtick
    this.eol = opts.eol == 1
    let uri = this._uri = getUri(opts.fullpath, buffer.id, buftype, this.env.isCygwin)
    if (token.isCancellationRequested) return false
    if (this.shouldAttach) {
      let res = await this.attach()
      if (!res) return false
      this._attached = true
    }
    this._filetype = this.convertFiletype(opts.filetype)
    this.textDocument = TextDocument.create(uri, this.filetype, 1, this.getDocumentContent())
    this.setIskeyword(opts.iskeyword)
    this.gitCheck()
    if (token.isCancellationRequested) {
      this.detach()
      return false
    }
    return true
  }

  private async attach(): Promise<boolean> {
    if (this.env.isVim) {
      this.lines = await this.nvim.call('getbufline', [this.bufnr, 1, '$'])
      return true
    }
    let attached = await this.buffer.attach(false)
    if (!attached) return false
    this.lines = await this.buffer.lines
    let lastChange: number
    this.buffer.listen('lines', (...args: any[]) => {
      // avoid neovim send same change multiple times after checktime
      if (lastChange == args[1]) return
      lastChange = args[1]
      this.onChange.apply(this, args)
    }, this.disposables)
    this.buffer.listen('detach', async buf => {
      this._onDocumentDetach.fire(buf.id)
    }, this.disposables)
    this.buffer.listen('changedtick', (_buf: Buffer, tick: number) => {
      this._changedtick = tick
    }, this.disposables)
    if (this.textDocument) {
      this.fireContentChanges()
    }
    return true
  }

  private onChange(
    buf: Buffer,
    tick: number,
    firstline: number,
    lastline: number,
    linedata: string[]
    // more:boolean
  ): void {
    if (buf.id !== this.buffer.id || tick == null) return
    this._changedtick = tick
    let lines = this.lines.slice(0, firstline)
    lines = lines.concat(linedata, this.lines.slice(lastline))
    this.lines = lines
    this.fireContentChanges()
  }

  /**
   * Make sure current document synced correctly
   */
  public async checkDocument(): Promise<void> {
    let { buffer } = this
    this._changedtick = await buffer.changedtick
    this.lines = await buffer.lines
    this.fireContentChanges.clear()
    this._fireContentChanges()
  }

  /**
   * Check if document changed after last synchronize
   */
  public get dirty(): boolean {
    return this.content != this.getDocumentContent()
  }

  private _fireContentChanges(): void {
    let { textDocument } = this
    let { cursor } = events
    try {
      let content = this.getDocumentContent()
      let endOffset = null
      if (cursor && cursor.bufnr == this.bufnr) {
        endOffset = this.getEndOffset(cursor.lnum, cursor.col, cursor.insert)
      }
      let change = getChange(this.content, content, endOffset)
      if (change == null) return
      this.createDocument()
      let { version, uri } = this
      let start = textDocument.positionAt(change.start)
      let end = textDocument.positionAt(change.end)
      let original = textDocument.getText(Range.create(start, end))
      let changes = [{
        range: { start, end },
        rangeLength: change.end - change.start,
        text: change.newText
      }]
      this._onDocumentChange.fire({
        bufnr: this.bufnr,
        original,
        textDocument: { version, uri },
        contentChanges: changes
      })
      this._words = this.chars.matchKeywords(this.textDocument.getText())
    } catch (e) {
      logger.error(e.message)
    }
  }

  /**
   * Buffer number
   */
  public get bufnr(): number {
    return this.buffer.id
  }

  /**
   * Content of textDocument.
   */
  public get content(): string {
    return this.textDocument.getText()
  }

  /**
   * Coverted filetype.
   */
  public get filetype(): string {
    return this._filetype
  }

  public get uri(): string {
    return this._uri
  }

  public get version(): number {
    return this.textDocument ? this.textDocument.version : null
  }

  public async applyEdits(edits: TextEdit[]): Promise<void> {
    if (!Array.isArray(arguments[0]) && Array.isArray(arguments[1])) {
      edits = arguments[1]
    }
    if (edits.length == 0) return
    edits.forEach(edit => {
      edit.newText = edit.newText.replace(/\r/g, '')
    })
    let current = this.lines.join('\n') + (this.eol ? '\n' : '')
    let textDocument = TextDocument.create(this.uri, this.filetype, 1, current)
    // apply edits to current textDocument
    let applied = TextDocument.applyEdits(textDocument, edits)
    // could be equal sometimes
    if (current !== applied) {
      let newLines = applied.split('\n')
      if (this.eol && newLines[newLines.length - 1] == '') {
        newLines = newLines.slice(0, -1)
      }
      let d = diffLines(this.lines, newLines)
      await this.buffer.setLines(d.replacement, {
        start: d.start,
        end: d.end,
        strictIndexing: false
      })
      // can't wait vim sync buffer
      this.lines = newLines
      this.forceSync()
    }
  }

  public changeLines(lines: [number, string][], sync = true, check = false): void {
    let { nvim } = this
    let filtered: [number, string][] = []
    for (let [lnum, text] of lines) {
      if (check && this.lines[lnum] != text) {
        filtered.push([lnum, text])
      }
      this.lines[lnum] = text
    }
    if (check && !filtered.length) return
    nvim.call('coc#util#change_lines', [this.bufnr, check ? filtered : lines], true)
    if (sync) this.forceSync()
  }

  /**
   * Force document synchronize and emit change event when necessary.
   */
  public forceSync(): void {
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

  private gitCheck(): void {
    let { uri } = this
    if (!uri.startsWith('file') || this.buftype != '') return
    let filepath = URI.parse(uri).fsPath
    isGitIgnored(filepath).then(isIgnored => {
      this.isIgnored = isIgnored
    }, () => {
      this.isIgnored = false
    })
  }

  private createDocument(changeCount = 1): void {
    let { version, uri, filetype } = this
    version = version + changeCount
    this.textDocument = TextDocument.create(
      uri,
      filetype,
      version,
      this.getDocumentContent()
    )
  }

  private async _fetchContent(): Promise<void> {
    if (!this.env.isVim || !this._attached) return
    let { nvim, buffer } = this
    let { id } = buffer
    let o = (await nvim.call('coc#util#get_content', id))
    if (!o) return
    let { content, changedtick } = o
    if (this._changedtick == changedtick) return
    this._changedtick = changedtick
    let newLines: string[] = content.split('\n')
    this.lines = newLines
    this.fireContentChanges.clear()
    this._fireContentChanges()
  }

  /**
   * Get and synchronize change
   */
  public async patchChange(currentLine?: boolean): Promise<void> {
    if (!this._attached) return
    if (this.env.isVim) {
      if (currentLine) {
        let change = await this.nvim.call('coc#util#get_changeinfo', []) as ChangeInfo
        if (change.changedtick == this._changedtick) return
        let { lines } = this
        let { lnum, line, changedtick } = change
        this._changedtick = changedtick
        lines[lnum - 1] = line
        this.forceSync()
      } else {
        this.fetchContent.clear()
        await this._fetchContent()
      }
    } else {
      // we have latest lines aftet TextChange on neovim
      this.forceSync()
    }
  }

  /**
   * Get ranges of word in textDocument.
   */
  public getSymbolRanges(word: string): Range[] {
    this.forceSync()
    let { textDocument } = this
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
   * Use matchaddpos for highlight ranges, must use `redraw` command on vim
   */
  public matchAddRanges(ranges: Range[], hlGroup: string, priority = 10): number[] {
    let res: number[] = []
    let arr: number[][] = []
    let splited: Range[] = ranges.reduce((p, c) => {
      for (let i = c.start.line; i <= c.end.line; i++) {
        let curr = this.getline(i) || ''
        let sc = i == c.start.line ? c.start.character : 0
        let ec = i == c.end.line ? c.end.character : curr.length
        if (sc == ec) continue
        p.push(Range.create(i, sc, i, ec))
      }
      return p
    }, [])
    for (let range of splited) {
      let { start, end } = range
      let line = this.getline(start.line)
      if (start.character == end.character) continue
      arr.push([start.line + 1, byteIndex(line, start.character) + 1, byteLength(line.slice(start.character, end.character))])
    }
    for (let grouped of group(arr, 8)) {
      let id = this.colorId
      this.colorId = this.colorId + 1
      this.nvim.call('matchaddpos', [hlGroup, grouped, priority, id], true)
      res.push(id)
    }
    return res
  }

  /**
   * Highlight ranges in document, return match id list.
   *
   * Note: match id could by namespace id or vim's match id.
   */
  public highlightRanges(ranges: Range[], hlGroup: string, srcId: number, priority = 10): number[] {
    let res: number[] = []
    if (this.env.isVim && !this.env.textprop) {
      res = this.matchAddRanges(ranges, hlGroup, priority)
    } else {
      let lineRanges = []
      for (let range of ranges) {
        if (range.start.line == range.end.line) {
          lineRanges.push(range)
        } else {
          // split range by lines
          for (let i = range.start.line; i < range.end.line; i++) {
            let line = this.getline(i)
            if (i == range.start.line) {
              lineRanges.push(Range.create(i, range.start.character, i, line.length))
            } else if (i == range.end.line) {
              lineRanges.push(Range.create(i, Math.min(line.match(/^\s*/)[0].length, range.end.character), i, range.end.character))
            } else {
              lineRanges.push(Range.create(i, Math.min(line.match(/^\s*/)[0].length, line.length), i, line.length))
            }
          }
        }
      }
      for (let range of lineRanges) {
        let { start, end } = range
        if (comparePosition(start, end) == 0) continue
        let line = this.getline(start.line)
        this.buffer.addHighlight({
          hlGroup,
          srcId,
          line: start.line,
          colStart: byteIndex(line, start.character),
          colEnd: end.line - start.line == 1 && end.character == 0 ? -1 : byteIndex(line, end.character)
        }).logError()
      }
      res.push(srcId)
    }
    return res
  }

  /**
   * Clear match id list, for vim support namespace, list should be namespace id list.
   */
  public clearMatchIds(ids: Set<number> | number[]): void {
    if (this.env.isVim && !this.env.textprop) {
      this.nvim.call('coc#util#clear_buf_matches', [Array.from(ids), this.bufnr], true)
    } else {
      ids = distinct(Array.from(ids))
      let hasNamesapce = this.nvim.hasFunction('nvim_create_namespace')
      ids.forEach(id => {
        if (hasNamesapce) {
          this.buffer.clearNamespace(id)
        } else {
          this.buffer.clearHighlight({ srcId: id })
        }
      })
    }
  }

  /**
   * Get cwd of this document.
   */
  public async getcwd(): Promise<string> {
    let wid = await this.nvim.call('bufwinid', this.buffer.id)
    if (wid == -1) return await this.nvim.call('getcwd')
    return await this.nvim.call('getcwd', wid)
  }

  /**
   * Real current line
   */
  public getline(line: number, current = true): string {
    if (current) return this.lines[line] || ''
    let lines = this.textDocument.getText().split(/\r?\n/)
    return lines[line] || ''
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
   * For normal mode, use offset -1 when possible
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
    let { uri, version } = this
    this._filetype = this.convertFiletype(filetype)
    version = version ? version + 1 : 1
    let textDocument = TextDocument.create(uri, this.filetype, version, this.content)
    this.textDocument = textDocument
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
    this.buffer.detach().catch(() => {
      // ignore invalid buffer error
    })
    this.disposables = []
    this.fetchContent.clear()
    this.fireContentChanges.clear()
    this._onDocumentChange.dispose()
    this._onDocumentDetach.dispose()
  }

  public get attached(): boolean {
    return this._attached
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
