import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { DidChangeTextDocumentParams, Emitter, Event, Position, Range, TextDocument, TextEdit, CancellationToken } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import { BufferOption, ChangeInfo, Env } from '../types'
import { diffLines, getChange } from '../util/diff'
import { isGitIgnored } from '../util/fs'
import { getUri, wait } from '../util/index'
import { byteIndex, byteLength } from '../util/string'
import { Chars } from './chars'
import { group } from '../util/array'
const logger = require('../util/logger')('model-document')

export type LastChangeType = 'insert' | 'change' | 'delete'

// wrapper class of TextDocument
export default class Document {
  public paused = false
  public buftype: string
  public isIgnored = false
  public chars: Chars
  public textDocument: TextDocument
  public fireContentChanges: Function & { clear(): void }
  public fetchContent: Function & { clear(): void }
  // vim only, for matchaddpos
  private colorId = 1080
  private nvim: Neovim
  private eol = true
  private attached = false
  // real current lines
  private lines: string[] = []
  private _filetype: string
  private _uri: string
  private _rootPatterns: string[]
  private _changedtick: number
  private _words: string[] = []
  private _onDocumentChange = new Emitter<DidChangeTextDocumentParams>()
  private _onDocumentDetach = new Emitter<string>()
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  public readonly onDocumentDetach: Event<string> = this._onDocumentDetach.event
  constructor(
    public readonly buffer: Buffer,
    private env: Env) {
    this.fireContentChanges = debounce(() => {
      this._fireContentChanges()
    }, 200)
    this.fetchContent = debounce(() => {
      this._fetchContent().catch(e => {
        logger.error(`Error on fetch content:`, e)
      })
    }, 50)
  }

  private shouldAttach(buftype: string): boolean {
    return buftype == '' || buftype == 'acwrite'
  }

  public get words(): string[] {
    return this._words
  }

  public setFiletype(filetype: string): void {
    let { uri, version } = this
    this._filetype = this.convertFiletype(filetype)
    version = version ? version + 1 : 1
    let textDocument = TextDocument.create(uri, this.filetype, version, this.content)
    this.textDocument = textDocument
  }

  public convertFiletype(filetype: string): string {
    let map = this.env.filetypeMap
    if (filetype == 'json' && this.uri && this.uri.endsWith('coc-settings.json')) {
      return 'jsonc'
    }
    if (filetype == 'javascript.jsx') return 'javascriptreact'
    if (filetype == 'typescript.jsx' || filetype == 'typescript.tsx') return 'typescriptreact'
    return map[filetype] || filetype
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

  public async init(nvim: Neovim, token: CancellationToken): Promise<boolean> {
    this.nvim = nvim
    let { buffer } = this
    let opts: BufferOption = await nvim.call('coc#util#get_bufoptions', buffer.id)
    if (opts == null) return false
    let buftype = this.buftype = opts.buftype
    this._changedtick = opts.changedtick
    this._rootPatterns = opts.rootPatterns
    this.eol = opts.eol == 1
    let uri = this._uri = getUri(opts.fullpath, buffer.id, buftype)
    token.onCancellationRequested(() => {
      this.detach()
    })
    try {
      if (!this.env.isVim) {
        let res = await this.attach()
        if (!res) return false
      } else {
        this.lines = await buffer.lines
      }
      this.attached = true
    } catch (e) {
      logger.error('attach error:', e)
      return false
    }
    this._filetype = this.convertFiletype(opts.filetype)
    this.textDocument = TextDocument.create(uri, this.filetype, 1, this.getDocumentContent())
    this.setIskeyword(opts.iskeyword)
    this.gitCheck()
    if (token.isCancellationRequested) return false
    return true
  }

  public setIskeyword(iskeyword: string): void {
    let chars = (this.chars = new Chars(iskeyword))
    this.buffer.getVar('coc_additional_keywords').then((keywords: string[]) => {
      if (keywords && keywords.length) {
        for (let ch of keywords) {
          chars.addKeyword(ch)
        }
        this._words = this.chars.matchKeywords(this.lines.join('\n'))
      }
    }, _e => {
      // noop
    })
  }

  public async attach(): Promise<boolean> {
    if (this.shouldAttach(this.buftype)) {
      let attached = await this.buffer.attach(false)
      if (!attached) return false
      this.lines = await this.buffer.lines
    } else {
      this.lines = await this.buffer.lines
      return true
    }
    if (!this.buffer.isAttached) return
    this.buffer.listen('lines', (...args) => {
      this.onChange.apply(this, args)
    })
    this.buffer.listen('detach', async () => {
      await wait(30)
      if (!this.attached) return
      // it could be detached by `edit!`
      let attached = await this.attach()
      if (!attached) this.detach()
    })
    this.buffer.listen('changedtick', (_buf: Buffer, tick: number) => {
      this._changedtick = tick
    })
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
   *
   * @public
   * @returns {Promise<void>}
   */
  public async checkDocument(): Promise<void> {
    this.paused = false
    let { buffer } = this
    this._changedtick = await buffer.changedtick
    this.lines = await buffer.lines
    this.fireContentChanges.clear()
    this._fireContentChanges()
  }

  public get dirty(): boolean {
    return this.content != this.getDocumentContent()
  }

  private _fireContentChanges(force = false): void {
    let { paused, textDocument } = this
    if (paused && !force) return
    try {
      let content = this.getDocumentContent()
      let change = getChange(this.content, content)
      if (change == null) return
      this.createDocument()
      let { version, uri } = this
      let start = textDocument.positionAt(change.start)
      let end = textDocument.positionAt(change.end)
      let changes = [{
        range: { start, end },
        rangeLength: change.end - change.start,
        text: change.newText
      }]
      logger.debug('changes:', JSON.stringify(changes, null, 2))
      this._onDocumentChange.fire({
        textDocument: { version, uri },
        contentChanges: changes
      })
      this._words = this.chars.matchKeywords(this.lines.join('\n'))
    } catch (e) {
      logger.error(e.message)
    }
  }

  public detach(): void {
    // neovim not detach on `:checktime`
    if (this.attached) {
      this.attached = false
      this.buffer.detach().catch(_e => {
        // noop
      })
      this._onDocumentDetach.fire(this.uri)
    }
    this.fetchContent.clear()
    this.fireContentChanges.clear()
    this._onDocumentChange.dispose()
    this._onDocumentDetach.dispose()
  }

  public get bufnr(): number {
    return this.buffer.id
  }

  public get content(): string {
    return this.textDocument.getText()
  }

  public get filetype(): string {
    return this._filetype
  }

  public get uri(): string {
    return this._uri
  }

  public get version(): number {
    return this.textDocument ? this.textDocument.version : null
  }

  public async applyEdits(_nvim: Neovim, edits: TextEdit[], sync = true): Promise<void> {
    if (edits.length == 0) return
    let orig = this.lines.join('\n') + (this.eol ? '\n' : '')
    let textDocument = TextDocument.create(this.uri, this.filetype, 1, orig)
    let content = TextDocument.applyEdits(textDocument, edits)
    // could be equal sometimes
    if (orig === content) {
      this.createDocument()
    } else {
      let d = diffLines(orig, content)
      await this.buffer.setLines(d.replacement, {
        start: d.start,
        end: d.end,
        strictIndexing: false
      })
      // can't wait vim sync buffer
      this.lines = (this.eol && content.endsWith('\n') ? content.slice(0, -1) : content).split('\n')
      if (sync) this.forceSync()
    }
  }

  public forceSync(ignorePause = true): void {
    this.fireContentChanges.clear()
    this._fireContentChanges(ignorePause)
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
   * Current word for replacement
   *
   * @public
   * @param {Position} position
   * @param {string} extraChars?
   * @param {boolean} current? - use current line
   * @returns {Range}
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
    let filepath = Uri.parse(uri).fsPath
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
    if (!this.env.isVim || !this.attached) return
    let { nvim, buffer } = this
    let { id } = buffer
    let o = (await nvim.call('coc#util#get_content', id)) as any
    if (!o) return
    let { content, changedtick } = o
    this._changedtick = changedtick
    let newLines: string[] = content.split('\n')
    this.lines = newLines
    this._fireContentChanges()
  }

  public async patchChange(): Promise<void> {
    if (!this.env.isVim || !this.attached) return
    let change = await this.nvim.call('coc#util#get_changeinfo', []) as ChangeInfo
    if (change.changedtick == this._changedtick) return
    let { lines } = this
    let { lnum, line, changedtick } = change
    this._changedtick = changedtick
    lines[lnum - 1] = line
  }

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

  public async patchChangedTick(): Promise<void> {
    if (!this.env.isVim || !this.attached) return
    this._changedtick = await this.nvim.call('getbufvar', [this.bufnr, 'changedtick'])
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

  public matchAddRanges(ranges: Range[], hlGroup: string, priority = 10): number[] {
    let res: number[] = []
    let method = this.env.isVim ? 'callTimer' : 'call'
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
      if (start.character == end.character) continue
      let line = this.getline(start.line)
      arr.push([start.line + 1, byteIndex(line, start.character) + 1, byteLength(line.slice(start.character, end.character))])
    }
    let id = this.colorId
    this.colorId = this.colorId + 1
    for (let grouped of group(arr, 8)) {
      this.nvim[method]('matchaddpos', [hlGroup, grouped, priority, id], true)
      res.push(id)
    }
    return res
  }

  public highlightRanges(ranges: Range[], hlGroup: string, srcId: number): number[] {
    let res: number[] = []
    if (this.env.isVim) {
      res = this.matchAddRanges(ranges, hlGroup, 10)
    } else {
      for (let range of ranges) {
        let { start, end } = range
        let line = this.getline(start.line)
        // tslint:disable-next-line: no-floating-promises
        this.buffer.addHighlight({
          hlGroup,
          srcId,
          line: start.line,
          colStart: byteIndex(line, start.character),
          colEnd: end.line - start.line == 1 && end.character == 0 ? -1 : byteIndex(line, end.character)
        })
        res.push(srcId)
      }
    }
    return res
  }

  public clearMatchIds(ids: Set<number> | number[]): void {
    if (this.env.isVim) {
      this.nvim.call('coc#util#clearmatches', [Array.from(ids)], true)
    } else {
      for (let id of ids) {
        if (this.nvim.hasFunction('nvim_create_namespace')) {
          this.buffer.clearNamespace(id)
        } else {
          this.buffer.clearHighlight({ srcId: id })
        }
      }
    }
  }

  public async getcwd(): Promise<string> {
    let wid = await this.nvim.call('bufwinid', this.buffer.id)
    if (wid == -1) return await this.nvim.call('getcwd')
    return await this.nvim.call('getcwd', wid)
  }

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

  /**
   * Real current line
   *
   * @public
   * @param {number} line - zero based line number
   * @param {boolean} current - use current line
   * @returns {string}
   */
  public getline(line: number, current = true): string {
    if (current) return this.lines[line] || ''
    let lines = this.textDocument.getText().split(/\r?\n/)
    return lines[line] || ''
  }

  public getDocumentContent(): string {
    let content = this.lines.join('\n')
    return this.eol ? content + '\n' : content
  }

  public get rootPatterns(): string[] | null {
    return this._rootPatterns
  }
}
