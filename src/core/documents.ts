import { Neovim } from '@chemzqm/neovim'
import bytes from 'bytes'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable, Emitter, Event, FormattingOptions, Location, LocationLink, TextDocumentSaveReason, TextEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import events, { InsertChange } from '../events'
import Document from '../model/document'
import TerminalModel, { TerminalOptions } from '../model/terminal'
import { LinesTextDocument } from '../model/textdocument'
import { BufferOption, DidChangeTextDocumentParams, Env, QuickfixItem, TextDocumentWillSaveEvent } from '../types'
import { disposeAll, platform } from '../util'
import { readFileLine } from '../util/fs'
import { byteIndex } from '../util/string'
import WorkspaceFolder from './workspaceFolder'
const logger = require('../util/logger')('core-documents')

export default class Documents implements Disposable {
  private _cwd: string
  private _env: Env
  private _bufnr: number
  private _root: string
  private _initialized = false
  private _attached = false
  private nvim: Neovim
  private maxFileSize: number
  private disposables: Disposable[] = []
  private creating: Set<number> = new Set()
  private buffers: Map<number, Document> = new Map()
  private _terminals: Map<number, TerminalModel> = new Map()
  private resolves: ((doc: Document) => void)[] = []
  private readonly _onDidOpenTerminal = new Emitter<TerminalModel>()
  private readonly _onDidCloseTerminal = new Emitter<TerminalModel>()
  private readonly _onDidOpenTextDocument = new Emitter<LinesTextDocument>()
  private readonly _onDidCloseDocument = new Emitter<LinesTextDocument>()
  private readonly _onDidChangeDocument = new Emitter<DidChangeTextDocumentParams>()
  private readonly _onDidSaveDocument = new Emitter<LinesTextDocument>()
  private readonly _onWillSaveDocument = new Emitter<TextDocumentWillSaveEvent>()

  public readonly onDidOpenTextDocument: Event<LinesTextDocument> = this._onDidOpenTextDocument.event
  public readonly onDidCloseDocument: Event<LinesTextDocument> = this._onDidCloseDocument.event
  public readonly onDidChangeDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onDidSaveTextDocument: Event<LinesTextDocument> = this._onDidSaveDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidCloseTerminal: Event<TerminalModel> = this._onDidCloseTerminal.event
  public readonly onDidOpenTerminal: Event<TerminalModel> = this._onDidOpenTerminal.event

  constructor(
    private readonly configurations: Configurations,
    private readonly workspaceFolder: WorkspaceFolder,
  ) {
    this._cwd = process.cwd()
  }

  public async attach(nvim: Neovim, env: Env): Promise<void> {
    if (this._attached) return
    this.nvim = nvim
    this._env = env
    this._attached = true
    let preferences = this.configurations.getConfiguration('coc.preferences')
    let maxFileSize = preferences.get<string>('maxFileSize', '10MB')
    this.maxFileSize = bytes.parse(maxFileSize)
    await nvim.setVar('coc_max_filesize', this.maxFileSize)
    let [bufs, bufnr, winid] = await this.nvim.eval(`[map(getbufinfo({'bufloaded': 1}),'v:val["bufnr"]'),bufnr('%'),win_getid()]`) as [number[], number, number]
    this._bufnr = bufnr
    await Promise.all(bufs.map(bufnr => this.createDocument(bufnr)))
    events.on('DirChanged', cwd => {
      this._cwd = cwd
    }, null, this.disposables)
    const checkCurrentBuffer = async (bufnr: number) => {
      this._bufnr = bufnr
      await this.checkBuffer(bufnr)
    }
    const onInsertLeave = (bufnr: number) => {
      let doc = this.getDocument(bufnr)
      if (!doc?.attached) return
      doc._forceSync()
    }
    events.on('InsertLeave', onInsertLeave, null, this.disposables)
    events.on('CursorMoved', checkCurrentBuffer, null, this.disposables)
    events.on('CursorMovedI', checkCurrentBuffer, null, this.disposables)
    events.on('TextChanged', this.checkBuffer, this, this.disposables)
    events.on('BufUnload', this.onBufUnload, this, this.disposables)
    events.on('TermClose', this.onBufUnload, this, this.disposables)
    events.on('BufEnter', this.onBufEnter, this, this.disposables)
    events.on('BufCreate', this.onBufCreate, this, this.disposables)
    events.on('TermOpen', this.onBufCreate, this, this.disposables)
    events.on('BufWritePost', this.onBufWritePost, this, this.disposables)
    events.on('BufWritePre', this.onBufWritePre, this, this.disposables)
    events.on('FileType', this.onFileTypeChange, this, this.disposables)
    void events.fire('BufEnter', [bufnr])
    void events.fire('BufWinEnter', [bufnr, winid])
    events.on('BufWinEnter', async (bufnr, _winid) => {
      this._bufnr = bufnr
      await this.createDocument(bufnr)
    }, null, this.disposables)
    if (this._env.isVim) {
      const onChange = (bufnr: number) => {
        let doc = this.buffers.get(bufnr)
        if (doc && doc.attached) doc.fetchContent()
      }
      events.on('TextChangedP', (bufnr, info: InsertChange) => {
        let doc = this.buffers.get(bufnr)
        if (doc && doc.attached) doc.changeLine(info.lnum, info.line, info.changedtick)
      }, null, this.disposables)
      events.on('TextChangedI', onChange, null, this.disposables)
      events.on('TextChanged', onChange, null, this.disposables)
    }
    this._initialized = true
  }

  public get bufnr(): number {
    return this._bufnr
  }

  public get root(): string {
    return this._root
  }

  public get cwd(): string {
    return this._cwd
  }

  public get documents(): Document[] {
    return Array.from(this.buffers.values()).filter(o => o.attached && !o.isCommandLine)
  }

  public get bufnrs(): number[] {
    return Array.from(this.buffers.keys())
  }

  public detach(): void {
    if (!this._attached) return
    this._attached = false
    for (let bufnr of this.buffers.keys()) {
      this.onBufUnload(bufnr)
    }
    disposeAll(this.disposables)
  }

  public get textDocuments(): LinesTextDocument[] {
    let docs: LinesTextDocument[] = []
    for (let b of this.buffers.values()) {
      if (b.attached) docs.push(b.textDocument)
    }
    return docs
  }

  public getDocument(uri: number | string): Document | null {
    if (typeof uri === 'number') {
      return this.buffers.get(uri)
    }
    const caseInsensitive = platform.isWindows || platform.isMacintosh
    uri = URI.parse(uri).toString()
    for (let doc of this.buffers.values()) {
      if (doc.uri === uri) return doc
      if (caseInsensitive && doc.uri.toLowerCase() === uri.toLowerCase()) return doc
    }
    return null
  }

  /**
   * Expand filepath with `~` and/or environment placeholders
   */
  public expand(input: string): string {
    if (input.startsWith('~')) {
      input = os.homedir() + input.slice(1)
    }
    if (input.includes('$')) {
      let doc = this.getDocument(this.bufnr)
      let fsPath = doc ? URI.parse(doc.uri).fsPath : ''
      input = input.replace(/\$\{(.*?)\}/g, (match: string, name: string) => {
        if (name.startsWith('env:')) {
          let key = name.split(':')[1]
          let val = key ? process.env[key] : ''
          return val
        }
        switch (name) {
          case 'workspace':
          case 'workspaceRoot':
          case 'workspaceFolder':
            return this._root
          case 'workspaceFolderBasename':
            return path.dirname(this._root)
          case 'cwd':
            return this._cwd
          case 'file':
            return fsPath
          case 'fileDirname':
            return fsPath ? path.dirname(fsPath) : ''
          case 'fileExtname':
            return fsPath ? path.extname(fsPath) : ''
          case 'fileBasename':
            return fsPath ? path.basename(fsPath) : ''
          case 'fileBasenameNoExtension': {
            let basename = fsPath ? path.basename(fsPath) : ''
            return basename ? basename.slice(0, basename.length - path.extname(basename).length) : ''
          }
          default:
            return match
        }
      })
      input = input.replace(/\$[\w]+/g, match => {
        if (match == '$HOME') return os.homedir()
        return process.env[match.slice(1)] || match
      })
    }
    return input
  }

  /**
   * Current document.
   */
  public get document(): Promise<Document> {
    return new Promise<Document>((resolve, reject) => {
      this.nvim.buffer.then(buf => {
        let bufnr = buf.id
        this._bufnr = bufnr
        if (this.buffers.has(bufnr)) {
          resolve(this.buffers.get(bufnr))
          return
        }
        void this.createDocument(bufnr)
        this.resolves.push(resolve)
      }, reject)
    })
  }

  public async createTerminal(opts: TerminalOptions): Promise<TerminalModel> {
    let cmd = opts.shellPath
    let args = opts.shellArgs
    if (!cmd) cmd = await this.nvim.getOption('shell') as string
    let terminal = new TerminalModel(cmd, args || [], this.nvim, opts.name)
    await terminal.start(opts.cwd || this.cwd, opts.env)
    this._terminals.set(terminal.bufnr, terminal)
    this._onDidOpenTerminal.fire(terminal)
    return terminal
  }

  public get uri(): string {
    let { bufnr } = this
    if (bufnr) {
      let doc = this.getDocument(bufnr)
      if (doc) return doc.uri
    }
    return null
  }

  /**
   * Current filetypes.
   */
  public get filetypes(): Set<string> {
    let res = new Set<string>()
    for (let doc of this.documents) {
      res.add(doc.filetype)
    }
    return res
  }

  /**
   * Current languageIds.
   */
  public get languageIds(): Set<string> {
    let res = new Set<string>()
    for (let doc of this.documents) {
      res.add(doc.languageId)
    }
    return res
  }

  /**
   * Get format options
   */
  public async getFormatOptions(uri?: string): Promise<FormattingOptions> {
    let doc: Document
    if (uri) doc = this.getDocument(uri)
    let bufnr = doc ? doc.bufnr : 0
    let res = await this.nvim.call('coc#util#get_format_opts', [bufnr]) as any
    let obj: FormattingOptions = { tabSize: res.tabsize, insertSpaces: res.expandtab == 1 }
    obj.insertFinalNewline = res.insertFinalNewline == 1
    if (res.trimTrailingWhitespace) obj.trimTrailingWhitespace = true
    if (res.trimFinalNewlines) obj.trimFinalNewlines = true
    return obj
  }

  private async createDocument(bufnr: number): Promise<void> {
    if (this.creating.has(bufnr)) return
    this.creating.add(bufnr)
    let opts = await this.nvim.call('coc#util#get_bufoptions', [bufnr])
    if (!opts) {
      this.creating.delete(bufnr)
      return
    }
    this._createDocument(bufnr, opts)
    this.creating.delete(bufnr)
  }

  private onBufCreate(bufnr: number): void {
    let doc = this.buffers.get(bufnr)
    if (doc) this.onBufUnload(bufnr)
  }

  private _createDocument(bufnr: number, opts: BufferOption | null): Document | undefined {
    if (this.buffers.has(bufnr)) return
    let buffer = this.nvim.createBuffer(bufnr)
    let doc = new Document(buffer, this._env)
    let created = doc.init(this.nvim, opts)
    if (!created) return
    this.buffers.set(bufnr, doc)
    if (doc.attached) {
      doc.onDocumentDetach(() => {
        this.onBufUnload(bufnr)
      })
      let configfile = this.configurations.resolveFolderConfigution(doc.uri)
      if (configfile) this.configurations.setFolderConfiguration(doc.uri)
      let root = this.workspaceFolder.resolveRoot(doc, this._cwd, this._initialized, this.expand.bind(this))
      if (root && this._bufnr == bufnr) this._root = root
      this._onDidOpenTextDocument.fire(doc.textDocument)
      doc.onDocumentChange(e => this._onDidChangeDocument.fire(e))
    }
    if (this.resolves.length) {
      this.resolves.forEach(fn => {
        fn(doc)
      })
      this.resolves = []
    }
    logger.debug('buffer created', bufnr, doc.uri)
    return doc
  }

  private onBufEnter(bufnr: number): void {
    this._bufnr = bufnr
    let doc = this.buffers.get(bufnr)
    if (doc) {
      this.configurations.setFolderConfiguration(doc.uri)
      let workspaceFolder = this.workspaceFolder.getWorkspaceFolder(URI.parse(doc.uri))
      if (workspaceFolder) this._root = URI.parse(workspaceFolder.uri).fsPath
    }
  }

  private onBufUnload(bufnr: number): void {
    this.creating.delete(bufnr)
    if (this._terminals.has(bufnr)) {
      logger.debug('terminal detach', bufnr)
      let terminal = this._terminals.get(bufnr)
      this._onDidCloseTerminal.fire(terminal)
      this._terminals.delete(bufnr)
    }
    let doc = this.buffers.get(bufnr)
    if (doc) {
      logger.debug('document detach', bufnr, doc.uri)
      if (doc.enabled) this._onDidCloseDocument.fire(doc.textDocument)
      this.buffers.delete(bufnr)
      doc.detach()
    }
  }

  private async checkBuffer(bufnr: number): Promise<void> {
    if (!this._attached || !bufnr) return
    let doc = this.getDocument(bufnr)
    if (!doc) await this.createDocument(bufnr)
  }

  private onBufWritePost(bufnr: number): void {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    this._onDidSaveDocument.fire(doc.textDocument)
  }

  private async onBufWritePre(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc || !doc.attached) return
    await doc.synchronize()
    let firing = true
    let thenables: Thenable<TextEdit[] | any>[] = []
    let event: TextDocumentWillSaveEvent = {
      document: doc.textDocument,
      reason: TextDocumentSaveReason.Manual,
      waitUntil: (thenable: Thenable<any>) => {
        if (!firing) {
          logger.error(`Can't call waitUntil in async manner:`, Error().stack)
          this.nvim.echoError(`waitUntil can't be used in async manner, check log for details`)
        } else {
          thenables.push(thenable)
        }
      }
    }
    this._onWillSaveDocument.fire(event)
    firing = false
    let total = thenables.length
    if (total) {
      let promise = new Promise<TextEdit[] | undefined>(resolve => {
        const preferences = this.configurations.getConfiguration('coc.preferences')
        const willSaveHandlerTimeout = preferences.get<number>('willSaveHandlerTimeout', 500)
        let timer = setTimeout(() => {
          this.nvim.outWriteLine(`Will save handler timeout after ${willSaveHandlerTimeout}ms`)
          resolve(undefined)
        }, willSaveHandlerTimeout)
        let i = 0
        let called = false
        for (let p of thenables) {
          let cb = (res: any) => {
            if (called) return
            called = true
            clearTimeout(timer)
            resolve(res)
          }
          p.then(res => {
            if (Array.isArray(res) && res.length && TextEdit.is(res[0])) {
              return cb(res)
            }
            i = i + 1
            if (i == total) cb(undefined)
          }, e => {
            logger.error(`Error on will save handler:`, e)
            i = i + 1
            if (i == total) cb(undefined)
          })
        }
      })
      let edits = await promise
      if (edits) await doc.applyEdits(edits)
    }
  }

  private onFileTypeChange(filetype: string, bufnr: number): void {
    let doc = this.getDocument(bufnr)
    if (!doc) return
    let converted = doc.convertFiletype(filetype)
    if (converted == doc.filetype) return
    this._onDidCloseDocument.fire(doc.textDocument)
    doc.setFiletype(filetype)
    this._onDidOpenTextDocument.fire(doc.textDocument)
  }

  public async getQuickfixList(locations: Location[]): Promise<ReadonlyArray<QuickfixItem>> {
    let filesLines: { [fsPath: string]: string[] } = {}
    let filepathList = locations.reduce<string[]>((pre: string[], curr) => {
      let u = URI.parse(curr.uri)
      if (u.scheme == 'file' && !pre.includes(u.fsPath) && !this.getDocument(curr.uri)) {
        pre.push(u.fsPath)
      }
      return pre
    }, [])

    await Promise.all(filepathList.map(fsPath => {
      return new Promise(resolve => {
        fs.readFile(fsPath, 'utf8', (err, content) => {
          if (err) return resolve(undefined)
          filesLines[fsPath] = content.split(/\r?\n/)
          resolve(undefined)
        })
      })
    }))
    return await Promise.all(locations.map(loc => {
      let { uri, range } = loc
      let { fsPath } = URI.parse(uri)
      let text: string | undefined
      let lines = filesLines[fsPath]
      if (lines) text = lines[range.start.line]
      return this.getQuickfixItem(loc, text)
    }))
  }

  /**
   * Convert location to quickfix item.
   */
  public async getQuickfixItem(loc: Location | LocationLink, text?: string, type = '', module?: string): Promise<QuickfixItem> {
    if (LocationLink.is(loc)) {
      loc = Location.create(loc.targetUri, loc.targetRange)
    }
    let doc = this.getDocument(loc.uri)
    let { uri, range } = loc
    let u = URI.parse(uri)
    if (!text && u.scheme == 'file') {
      text = await this.getLine(uri, range.start.line)
    }
    let item: QuickfixItem = {
      uri,
      filename: u.scheme == 'file' ? u.fsPath : uri,
      lnum: range.start.line + 1,
      end_lnum: range.end.line + 1,
      col: text ? byteIndex(text, range.start.character) + 1 : range.start.character + 1,
      end_col: text ? byteIndex(text, range.end.character) + 1 : range.end.character + 1,
      text: text || '',
      range
    }
    if (module) item.module = module
    if (type) item.type = type
    if (doc) item.bufnr = doc.bufnr
    return item
  }

  /**
   * Get content of line by uri and line.
   */
  public async getLine(uri: string, line: number): Promise<string> {
    let document = this.getDocument(uri)
    if (document) return document.getline(line) || ''
    if (!uri.startsWith('file:')) return ''
    let fsPath = URI.parse(uri).fsPath
    if (!fs.existsSync(fsPath)) return ''
    return await readFileLine(fsPath, line)
  }

  /**
   * Get content from buffer or file by uri.
   */
  public async readFile(uri: string): Promise<string> {
    let document = this.getDocument(uri)
    if (document) {
      await document.patchChange()
      return document.content
    }
    let u = URI.parse(uri)
    if (u.scheme != 'file') return ''
    let lines = await this.nvim.call('readfile', [u.fsPath]) as string[]
    return lines.join('\n') + '\n'
  }

  public reset(): void {
    this.creating.clear()
    for (let bufnr of this.buffers.keys()) {
      this.onBufUnload(bufnr)
    }
    this.buffers.clear()
    this._terminals.clear()
    this._root = process.cwd()
  }

  public dispose(): void {
    for (let bufnr of this.buffers.keys()) {
      this.onBufUnload(bufnr)
    }
    this.resolves = []
    this._attached = false
    this.buffers.clear()
    this._terminals.clear()
    disposeAll(this.disposables)
  }
}
