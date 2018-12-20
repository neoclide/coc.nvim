import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import semver from 'semver'
import { DidChangeTextDocumentParams, Emitter, Event, Position, Range, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import { BufferOption, ChangeInfo, Env, WorkspaceConfiguration } from '../types'
import { diffLines, getChange } from '../util/diff'
import { isGitIgnored } from '../util/fs'
import { convertFiletype, getUri, wait } from '../util/index'
import { byteIndex, byteLength } from '../util/string'
import { Chars } from './chars'
const logger = require('../util/logger')('model-document')

export type LastChangeType = 'insert' | 'change' | 'delete'

// wrapper class of TextDocument
export default class Document {
  public paused: boolean
  public buftype: string
  public isIgnored = false
  public chars: Chars
  public textDocument: TextDocument
  public fetchContent: Function & { clear(): void }
  // vim only, for matchaddpos
  private colorId = 1080
  private nvim: Neovim
  private _lastChange: LastChangeType = 'insert'
  private eol = true
  private _fireContentChanges: Function & { clear(): void }
  private _filetype: string
  private attached = false
  // real current lines
  private lines: string[] = []
  private _changedtick: number
  private _words: string[] = []
  private _onDocumentChange = new Emitter<DidChangeTextDocumentParams>()
  private _onDocumentDetach = new Emitter<string>()
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  public readonly onDocumentDetach: Event<string> = this._onDocumentDetach.event
  constructor(
    public readonly buffer: Buffer,
    private configurations: WorkspaceConfiguration,
    private env: Env) {
    this._fireContentChanges = debounce(() => {
      this.fireContentChanges()
    }, 100)
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
          paused = false
          // not send immediatelly
          this.fireContentChanges()
        }
      }
    })
  }

  private shouldAttach(buftype: string): boolean {
    let { isVim, version } = this.env
    // no need to attach these buffers
    if (['help', 'quickfix', 'nofile'].indexOf(buftype) != -1) return false
    if (buftype == 'terminal' && !isVim) {
      if (semver.lt(version, '0.3.2')) return false
    }
    return true
  }

  public get words(): string[] {
    return this._words
  }

  public get lastChange(): LastChangeType {
    return this._lastChange
  }

  private generateWords(): void {
    if (this.isIgnored) return
    let limit = this.configurations.get<number>('limitLines', 5000)
    let lines = this.lines.slice(0, limit)
    this._words = this.chars.matchKeywords(lines.join('\n'))
  }

  public setFiletype(filetype: string): void {
    let { uri, version } = this
    this._filetype = convertFiletype(filetype, this.env.filetypeMap)
    version = version ? version + 1 : 1
    let textDocument = TextDocument.create(uri, this.filetype, version, this.content)
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

  public async init(nvim: Neovim): Promise<boolean> {
    this.nvim = nvim
    let { buffer } = this
    let opts: BufferOption = await nvim.call('coc#util#get_bufoptions', buffer.id)
    if (!opts) return false
    let buftype = this.buftype = opts.buftype
    this._changedtick = opts.changedtick
    this.eol = opts.eol == 1
    let bufname = buftype == 'nofile' || opts.bufname == '' ? opts.bufname : opts.fullpath
    let uri = getUri(bufname, buffer.id, buftype)
    if (this.shouldAttach(buftype)) {
      if (!this.env.isVim) {
        let res = await this.attach()
        if (!res) return false
      } else {
        this.lines = (await buffer.lines) as string[]
      }
      this.attached = true
    }
    this._filetype = convertFiletype(opts.filetype, this.env.filetypeMap)
    this.textDocument = TextDocument.create(uri, this.filetype, 1, this.getDocumentContent())
    this.setIskeyword(opts.iskeyword)
    return true
  }

  public setIskeyword(iskeyword: string): void {
    let chars = (this.chars = new Chars(iskeyword))
    // normal buffer only
    if (this.buftype !== '') return
    let config = this.configurations
    let hyphenAsKeyword = config.get<boolean>('hyphenAsKeyword', true)
    if (hyphenAsKeyword) chars.addKeyword('-')
    this.gitCheck().then(() => {
      this.generateWords()
    }, e => {
      logger.error('git error', e.stack)
    })
  }

  public async attach(): Promise<boolean> {
    if (this.buffer.isAttached) return false
    let attached = await this.buffer.attach(false)
    if (!attached) return false
    this.lines = (await this.buffer.lines) as string[]
    if (!this.buffer.isAttached) return
    this.buffer.listen('lines', (...args) => {
      this.onChange.apply(this, args)
    })
    this.buffer.listen('detach', async () => {
      await wait(30)
      if (!this.attached) return
      // it could be detached by `edit!`
      await this.attach()
    })
    this.buffer.listen('changedtick', (_buf: Buffer, tick: number) => {
      this._changedtick = tick
    })
    if (this.textDocument) {
      this._fireContentChanges()
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
    let c = lastline - firstline - linedata.length
    if (c > 0) {
      this._lastChange = 'delete'
    } else if (c < 0) {
      this._lastChange = 'insert'
    } else {
      this._lastChange = 'change'
    }
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
    return this.content != this.getDocumentContent()
  }

  private fireContentChanges(force = false): void {
    let { paused, textDocument } = this
    if (paused && !force) return
    try {
      let content = this.getDocumentContent()
      if (content == this.content) return
      let change = getChange(this.content, content)
      this.createDocument()
      let { version, uri } = this
      let start = textDocument.positionAt(change.start)
      let end = textDocument.positionAt(change.end)
      let changes = [{
        range: { start, end },
        rangeLength: change.end - change.start,
        text: change.newText
      }]
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
    this._onDocumentDetach.fire(this.uri)
    this.buffer.detach().catch(_e => {
      // noop
    })
    this.fetchContent.clear()
    this._fireContentChanges.clear()
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
    this.forceSync()
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
    this.forceSync()
  }

  public forceSync(): void {
    this._fireContentChanges.clear()
    this.fireContentChanges(true)
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
  public getWordRangeAtPosition(position: Position, extraChars?: string, current = false): Range | null {
    let chars = new Chars('@,48-57,_')
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
      this.getDocumentContent()
    )
  }

  private async _fetchContent(): Promise<void> {
    if (!this.env.isVim || !this.attached) return
    let { nvim, buffer } = this
    let { id } = buffer
    let o = (await nvim.call('coc#util#get_content', [id])) as any
    if (!o) return
    let { content, changedtick } = o
    this._changedtick = changedtick
    let newLines: string[] = content.split('\n')
    if (newLines.length > this.lineCount) {
      this._lastChange = 'insert'
    } else if (newLines.length < this.lineCount) {
      this._lastChange = 'delete'
    } else {
      this._lastChange = 'change'
    }
    this.lines = newLines
    this.fireContentChanges()
  }

  public async patchChange(): Promise<void> {
    if (!this.env.isVim || !this.attached) return
    let change = await this.nvim.call('coc#util#get_changeinfo', []) as ChangeInfo
    if (change.changedtick == this._changedtick) return
    let { lines } = this
    let { lnum, line, changedtick } = change
    this._changedtick = changedtick
    this._lastChange = 'change'
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

  public async highlightRanges(ranges: Range[], hlGroup: string, srcId: number): Promise<number[]> {
    let { nvim, bufnr } = this
    let res: number[] = []
    if (this.env.isVim) {
      let curr = await nvim.call('bufnr', '%') as number
      if (bufnr != curr) return []
      let group: Range[] = []
      for (let i = 0, l = ranges.length; i < l; i++) {
        if (group.length < 8) {
          group.push(ranges[i])
        } else {
          group = []
          group.push(ranges[i])
        }
        if (group.length == 8 || i == l - 1) {
          let arr: number[][] = []
          for (let range of group) {
            let { start, end } = range
            let line = this.getline(start.line)
            if (end.line - start.line == 1 && end.character == 0) {
              arr.push([start.line + 1])
            } else {
              arr.push([start.line + 1, byteIndex(line, start.character) + 1, byteLength(line.slice(start.character, end.character))])
            }
          }
          let id = this.colorId
          this.colorId = this.colorId + 1
          nvim.call('matchaddpos', [hlGroup, arr, 9, id], true)
          res.push(id)
        }
      }
    } else {
      if (srcId == 0) {
        srcId = await this.buffer.addHighlight({ hlGroup: '', srcId, line: 0, colStart: 0, colEnd: 0 })
      }
      if (srcId) {
        for (let range of ranges) {
          let { start, end } = range
          let line = this.getline(start.line)
          await this.buffer.addHighlight({
            hlGroup,
            srcId,
            line: start.line,
            colStart: byteIndex(line, start.character),
            colEnd: end.line - start.line == 1 && end.character == 0 ? -1 : byteIndex(line, end.character)
          })
        }
        res.push(srcId)
      }
    }
    return res
  }

  public clearMatchIds(ids: Set<number> | number[]): void {
    if (this.env.isVim) {
      this.nvim.call('coc#util#clearmatches', [this.bufnr, Array.from(ids)], true)
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

  public getLocalifyBonus(position: Position): Map<string, number> {
    let res: Map<string, number> = new Map()
    let { chars } = this
    let start = Math.max(0, position.line - 500)
    let content = this.lines.slice(start, position.line + 1).join('\n')
    let end = content.length - 1
    for (let i = content.length - 1; i >= 0; i--) {
      let iskeyword = chars.isKeyword(content[i])
      if (!iskeyword || i == 0) {
        if (end - i > 0) {
          let str = content.slice(i == 0 ? 0 : i + 1, end + 1)
          if (!res.has(str)) res.set(str, i)
        }
        end = i - 1
      }
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
    let str = this.textDocument.getText(Range.create(line, 0, line + 1, 0))
    return str ? str.replace(/\n$/, '') : ''
  }

  private getDocumentContent(): string {
    let content = this.lines.join('\n')
    return this.eol ? content + '\n' : content
  }
}
