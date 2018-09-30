import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { DidChangeTextDocumentParams, DocumentHighlight, DocumentHighlightKind, Emitter, Event, Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import { BufferOption, ChangeInfo } from '../types'
import { diffLines, getChange } from '../util/diff'
import { isGitIgnored } from '../util/fs'
import { getUri, wait } from '../util/index'
import { byteIndex, byteLength } from '../util/string'
import { Chars } from './chars'
const logger = require('../util/logger')('model-document')

// wrapper class of TextDocument
export default class Document {
  public paused: boolean
  public buftype: string
  public isIgnored = false
  public chars: Chars
  public textDocument: TextDocument
  public fetchContent: Function & { clear(): void }
  private nvim: Neovim
  private srcId = 0
  private _fireContentChanges: Function & { clear(): void }
  private attached = false
  // real current lines
  private lines: string[] = []
  private _changedtick: number
  private _words: string[] = []
  private _onDocumentChange = new Emitter<DidChangeTextDocumentParams>()
  private _onDocumentDetach = new Emitter<TextDocument>()
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  public readonly onDocumentDetach: Event<TextDocument> = this._onDocumentDetach.event
  constructor(public readonly buffer: Buffer) {
    this._fireContentChanges = debounce(() => {
      this.fireContentChanges()
    }, 20)
    this.fetchContent = debounce(() => {
      this._fetchContent().catch(_e => {
        // noop
      })
    }, 50)
    let paused = false
    Object.defineProperty(this, 'paused', {
      get: () => {
        return paused
      },
      set: (val: boolean) => {
        if (val == paused) return
        if (val) {
          // fire immediatelly
          this._fireContentChanges.clear()
          this.fireContentChanges()
          paused = true
        } else {
          // setImmediate(() => {
          //   logger.debug('line:', this.getline(37))
          // })
          paused = false
          // fire immediatelly
          this._fireContentChanges.clear()
          this.fireContentChanges()
        }
      }
    })
  }

  public get words(): string[] {
    return this._words
  }

  private generateWords(): void {
    if (this.isIgnored) return
    let { content } = this
    this._words = this.chars.matchKeywords(content)
  }

  public setFiletype(filetype: string): void {
    let { uri, version } = this
    version = version ? version + 1 : 1
    let textDocument = TextDocument.create(uri, filetype, version, this.content)
    this.textDocument = textDocument
  }

  /**
   * Current changedtick of buffer
   *
   * @public
   * @returns {number}
   */
  public get changedtick(): number {
    return this._changedtick
  }

  public get schema(): string {
    return Uri.parse(this.uri).scheme
  }

  public get lineCount(): number {
    return this.lines.length
  }

  public async init(
    nvim: Neovim,
    buftype: string,
    isNvim: boolean
  ): Promise<boolean> {
    this.nvim = nvim
    let { buffer } = this
    this.buftype = buftype
    if (isNvim) {
      let res = await this.attach()
      if (!res) return false
    }
    this.attached = true
    let opts = (await nvim.call('coc#util#get_bufoptions', [
      buffer.id
    ])) as BufferOption
    this._changedtick = opts.changedtick
    this.lines = (await buffer.lines) as string[]
    let { fullpath, filetype, iskeyword } = opts
    let uri = getUri(fullpath, buffer.id)
    this.textDocument = TextDocument.create(
      uri,
      filetype,
      0,
      this.lines.join('\n')
    )
    let chars = (this.chars = new Chars(iskeyword))
    if (this.includeDash(filetype)) chars.addKeyword('-')
    this.gitCheck().then(
      () => {
        this.generateWords()
      },
      e => {
        logger.error('git error', e.stack)
      }
    )
    return true
  }

  /**
   * Real current line
   *
   * @public
   * @param {number} line - zero based line number
   * @returns {string}
   */
  public getline(line: number): string {
    return this.lines[line] || ''
  }

  public async attach(): Promise<boolean> {
    if (this.buffer.isAttached) return true
    let attached = await this.buffer.attach()
    if (!attached) return false
    this.buffer.listen('lines', (...args) => {
      this.onChange.apply(this, args)
    })
    this.buffer.listen('detach', async () => {
      this._onDocumentDetach.fire(this.textDocument)
      await wait(30)
      if (!this.attached) return
      // it could be detached by `edit!`
      await this.attach()
    })
    this.buffer.listen('changedtick', (_buf: Buffer, tick: number) => {
      this._changedtick = tick
    })
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
    if (tick == null) return
    if (buf.id !== this.buffer.id) return
    this._changedtick = tick
    this.lines.splice(firstline, lastline - firstline, ...linedata)
    this._fireContentChanges()
  }

  /**
   * Make sure current document synced correctly
   *
   * @public
   * @returns {Promise<void>}
   */
  public async checkDocument(): Promise<void> {
    this.paused = false
    let { buffer } = this
    this._changedtick = await buffer.changedtick
    this.lines = await buffer.lines
    this._fireContentChanges.clear()
    this.fireContentChanges()
  }

  public get dirty(): boolean {
    return this.content != this.lines.join('\n')
  }

  private fireContentChanges(): void {
    let { paused, textDocument } = this
    if (paused) return
    try {
      let content = this.lines.join('\n')
      if (content == this.content) return
      let change = getChange(this.content, content)
      this.createDocument()
      let { version, uri } = this
      let changes = [
        {
          range: {
            start: textDocument.positionAt(change.start),
            end: textDocument.positionAt(change.end)
          },
          rangeLength: change.end - change.start,
          text: change.newText
        }
      ]
      this._onDocumentChange.fire({
        textDocument: { version, uri },
        contentChanges: changes
      })
      this.generateWords()
    } catch (e) {
      logger.error(e.message)
    }
  }

  public async detach(): Promise<void> {
    if (!this.attached) return
    // neovim not detach on `:checktime`
    this.attached = false
    try {
      await this.buffer.detach()
    } catch (e) {
      // noop
    }
    this.fetchContent.clear()
    this._fireContentChanges.clear()
    this._onDocumentChange.dispose()
  }

  public get bufnr(): number {
    return this.buffer.id
  }

  public get content(): string {
    return this.textDocument.getText()
  }

  public get filetype(): string {
    return this.textDocument.languageId
  }

  public get uri(): string {
    return this.textDocument ? this.textDocument.uri : null
  }

  public get version(): number {
    return this.textDocument ? this.textDocument.version : null
  }

  public equalTo(doc: TextDocument): boolean {
    return doc.uri == this.uri
  }

  public setKeywordOption(option: string): void {
    this.chars = new Chars(option)
  }

  public async applyEdits(nvim: Neovim, edits: TextEdit[]): Promise<void> {
    if (edits.length == 0) return
    let orig = this.content
    let content = TextDocument.applyEdits(this.textDocument, edits)
    // could be equal
    if (orig === content) return
    let cur = await nvim.buffer
    let buf = this.buffer
    if (cur.id == buf.id) {
      let d = diffLines(orig, content)
      if (d.end - d.start == 1 && d.replacement.length == 1) {
        await nvim.call('coc#util#setline', [d.start + 1, d.replacement[0]])
      } else {
        await buf.setLines(d.replacement, {
          start: d.start,
          end: d.end,
          strictIndexing: false
        })
      }
    } else {
      await buf.setLines(content.split(/\r?\n/), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
    }
    this._fireContentChanges.clear()
    this.fireContentChanges()
  }

  public forceSync(ignorePause = false): void {
    if (this.paused && ignorePause) {
      this.paused = false
    } else {
      this._fireContentChanges.clear()
      this.fireContentChanges()
    }
  }

  public getOffset(lnum: number, col: number): number {
    return this.textDocument.offsetAt({
      line: lnum - 1,
      character: col
    })
  }

  public isWord(word: string): boolean {
    return this.chars.isKeyword(word)
  }

  public getMoreWords(): string[] {
    let res = []
    let { words, chars } = this
    if (!chars.isKeywordChar('-')) return res
    for (let word of words) {
      word = word.replace(/^-+/, '')
      if (word.indexOf('-') !== -1) {
        let parts = word.split('-')
        for (let part of parts) {
          if (
            part.length > 2 &&
            res.indexOf(part) === -1 &&
            words.indexOf(part) === -1
          ) {
            res.push(part)
          }
        }
      }
    }
    return res
  }

  /**
   * Current word for replacement, used by completion
   * For increment completion, the document is initialized document
   *
   * @public
   * @param {Position} position
   * @param {string} extraChars?
   * @returns {Range}
   */
  public getWordRangeAtPosition(
    position: Position,
    extraChars?: string
  ): Range {
    let { chars, textDocument } = this
    let content = textDocument.getText()
    if (extraChars && extraChars.length) {
      let codes = []
      let keywordOption = '@,'
      for (let i = 0; i < extraChars.length; i++) {
        codes.push(String(extraChars.charCodeAt(i)))
      }
      keywordOption += codes.join(',')
      chars = new Chars(keywordOption)
    }
    let start = position
    let end = position
    let offset = textDocument.offsetAt(position)
    for (let i = offset - 1; i >= 0; i--) {
      if (i == 0) {
        start = textDocument.positionAt(0)
        break
      } else if (!chars.isKeywordChar(content[i])) {
        start = textDocument.positionAt(i + 1)
        break
      }
    }
    for (let i = offset; i <= content.length; i++) {
      if (i === content.length) {
        end = textDocument.positionAt(i)
        break
      } else if (!chars.isKeywordChar(content[i])) {
        end = textDocument.positionAt(i)
        break
      }
    }
    return { start, end }
  }

  private includeDash(filetype): boolean {
    return (
      ['json', 'html', 'wxml', 'css', 'less', 'scss', 'wxss'].indexOf(
        filetype
      ) != -1
    )
  }

  private async gitCheck(): Promise<void> {
    let { uri } = this
    if (!uri.startsWith('file')) return
    let filepath = Uri.parse(uri).fsPath
    this.isIgnored = await isGitIgnored(filepath)
  }

  private createDocument(changeCount = 1): void {
    let { version, uri, filetype } = this
    version = version + changeCount
    this.textDocument = TextDocument.create(
      uri,
      filetype,
      version,
      this.lines.join('\n')
    )
  }

  private async _fetchContent(): Promise<void> {
    let { nvim, buffer } = this
    let { id } = buffer
    let o = (await nvim.call('coc#util#get_content', [id])) as any
    if (!o) return
    let { content, changedtick } = o
    this._changedtick = changedtick
    this.lines = content.split('\n')
    this.fireContentChanges()
  }

  public patchChange(change: ChangeInfo): void {
    let { lines } = this
    let { lnum, line, changedtick } = change
    this._changedtick = changedtick
    lines[lnum - 1] = line
    this.fireContentChanges()
  }

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
      if (!chars.isKeywordChar(c) && valids.indexOf(c) === -1) {
        break
      }
      col = col - byteLength(c)
    }
    return col
  }

  public async setHighlights(highlights: DocumentHighlight[]): Promise<void> {
    let { srcId, buffer } = this
    if (srcId == 0) {
      srcId = await buffer.addHighlight({ srcId, hlGroup: '', line: 0, colStart: 0, colEnd: 0 })
      this.srcId = srcId
    } else {
      buffer.clearHighlight({ srcId })
    }
    for (let hl of highlights) {
      let hlGroup = hl.kind == DocumentHighlightKind.Text
        ? 'CocHighlightText'
        : hl.kind == DocumentHighlightKind.Read
          ? 'CocHighlightRead'
          : 'CocHighlightWrite'
      await this.highlightRange(hl.range, srcId, hlGroup)
    }
  }

  private async highlightRange(range: Range, srcId: number, hlGroup: string): Promise<void> {
    let { buffer } = this
    let { start, end } = range
    for (let i = start.line; i <= end.line; i++) {
      let line = this.getline(i)
      if (!line || !line.length) continue
      let s = i == start.line ? start.character : 0
      let e = i == end.line ? end.character : -1
      await buffer.addHighlight({
        srcId,
        hlGroup,
        line: i,
        colStart: s == 0 ? 0 : byteIndex(line, s),
        colEnd: e == -1 ? -1 : byteIndex(line, e),
      })
    }
  }

  public clearHighlight(): void {
    let { srcId, buffer } = this
    if (srcId) {
      buffer.clearHighlight({ srcId })
    }
  }

  public async getcwd(): Promise<string> {
    let wid = await this.nvim.call('bufwinid', this.buffer.id)
    if (wid == -1) return await this.nvim.call('getcwd')
    return await this.nvim.call('getcwd', wid)
  }
}
