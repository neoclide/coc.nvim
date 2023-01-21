'use strict'
import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions, Location, LocationLink, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import { IConfigurationChangeEvent } from '../configuration/types'
import events, { InsertChange } from '../events'
import { createLogger } from '../logger'
import Document from '../model/document'
import { LinesTextDocument } from '../model/textdocument'
import { BufferOption, DidChangeTextDocumentParams, Env, LocationWithTarget, QuickfixItem } from '../types'
import { defaultValue, disposeAll } from '../util'
import { normalizeFilePath, readFile, readFileLine, resolveRoot } from '../util/fs'
import { fs, os, path } from '../util/node'
import * as platform from '../util/platform'
import { Disposable, Emitter, Event, TextDocumentSaveReason } from '../util/protocol'
import { byteIndex } from '../util/string'
import type { TextDocumentWillSaveEvent } from './files'
import WorkspaceFolder from './workspaceFolder'
const logger = createLogger('core-documents')

interface StateInfo {
  bufnr: number
  winid: number
  bufnrs: number[]
  winids: number[]
}

interface DocumentsConfig {
  maxFileSize: number
  willSaveHandlerTimeout: number
  useQuickfixForLocations: boolean
}

const cwd = normalizeFilePath(process.cwd())

export default class Documents implements Disposable {
  private _cwd: string
  private _env: Env
  private _bufnr: number
  private _root: string
  private _attached = false
  private _currentResolve = false
  private nvim: Neovim
  private config: DocumentsConfig
  private disposables: Disposable[] = []
  private creating: Map<number, Promise<Document | undefined>> = new Map()
  public buffers: Map<number, Document> = new Map()
  private resolves: ((doc: Document) => void)[] = []
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

  constructor(
    private readonly configurations: Configurations,
    private readonly workspaceFolder: WorkspaceFolder,
  ) {
    this._cwd = cwd
    this.getConfiguration()
    this.configurations.onDidChange(this.getConfiguration, this, this.disposables)
  }

  public async attach(nvim: Neovim, env: Env): Promise<void> {
    if (this._attached) return
    this.nvim = nvim
    this._env = env
    this._attached = true
    let { bufnrs, bufnr } = await this.nvim.call('coc#util#all_state') as StateInfo
    this._bufnr = bufnr
    await Promise.all(bufnrs.map(bufnr => this.createDocument(bufnr)))
    events.on('BufDetach', this.onBufDetach, this, this.disposables)
    events.on('BufRename', async bufnr => {
      this.detachBuffer(bufnr)
      await this.createDocument(bufnr)
    }, null, this.disposables)
    events.on('DirChanged', cwd => {
      this._cwd = normalizeFilePath(cwd)
    }, null, this.disposables)
    const checkCurrentBuffer = (bufnr: number) => {
      this._bufnr = bufnr
      void this.createDocument(bufnr)
    }
    events.on('CursorMoved', checkCurrentBuffer, null, this.disposables)
    events.on('CursorMovedI', checkCurrentBuffer, null, this.disposables)
    events.on('BufUnload', this.onBufUnload, this, this.disposables)
    events.on('BufEnter', this.onBufEnter, this, this.disposables)
    events.on('BufCreate', this.onBufCreate, this, this.disposables)
    events.on('TermOpen', this.onBufCreate, this, this.disposables)
    events.on('BufWritePost', this.onBufWritePost, this, this.disposables)
    events.on('BufWritePre', this.onBufWritePre, this, this.disposables)
    events.on('FileType', this.onFileTypeChange, this, this.disposables)
    events.on('BufEnter', (bufnr: number) => {
      void this.createDocument(bufnr)
    }, null, this.disposables)
    if (this._env.isVim) {
      ['TextChangedP', 'TextChangedI', 'TextChanged'].forEach(event => {
        events.on(event as any, (bufnr: number, info?: InsertChange) => {
          let doc = this.buffers.get(bufnr)
          if (doc && doc.attached) doc.onTextChange(event, info)
        }, null, this.disposables)
      })
    }
  }

  private getConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('coc.preferences')) {
      let config = this.configurations.initialConfiguration.get('coc.preferences') as any
      const bytes = require('bytes')
      this.config = {
        maxFileSize: bytes.parse(config.maxFileSize),
        willSaveHandlerTimeout: defaultValue(config.willSaveHandlerTimeout, 500),
        useQuickfixForLocations: config.useQuickfixForLocations
      }
    }
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
    return Array.from(this.buffers.values()).filter(o => o.attached)
  }

  public async getCurrentUri(): Promise<string | undefined> {
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    let doc = this.getDocument(bufnr)
    return doc ? doc.uri : undefined
  }

  public *attached(schema?: string): Iterable<Document> {
    for (let doc of this.buffers.values()) {
      if (!doc.attached) continue
      if (schema && doc.schema !== schema) continue
      yield doc
    }
  }

  public get bufnrs(): Iterable<number> {
    return this.buffers.keys()
  }

  public detach(): void {
    this._attached = false
    for (let bufnr of this.buffers.keys()) {
      this.onBufUnload(bufnr)
    }
  }

  public resolveRoot(rootPatterns: string[], requireRootPattern = false): string | undefined {
    let doc = this.getDocument(this.bufnr)
    let resolved: string | undefined
    if (doc && doc.schema == 'file') {
      let dir = path.dirname(URI.parse(doc.uri).fsPath)
      resolved = resolveRoot(dir, rootPatterns, this.cwd)
    } else {
      resolved = resolveRoot(this.cwd, rootPatterns)
    }
    if (requireRootPattern && !resolved) {
      throw new Error(`Required root pattern not resolved.`)
    }
    return resolved
  }

  public get textDocuments(): LinesTextDocument[] {
    let docs: LinesTextDocument[] = []
    for (let b of this.buffers.values()) {
      if (b.attached) docs.push(b.textDocument)
    }
    return docs
  }

  public getDocument(uri: number | string, caseInsensitive = platform.isWindows || platform.isMacintosh): Document | null {
    if (typeof uri === 'number') {
      return this.buffers.get(uri)
    }
    let u = URI.parse(uri)
    uri = u.toString()
    let isFile = u.scheme === 'file'
    for (let doc of this.buffers.values()) {
      if (doc.uri === uri) return doc
      if (isFile && caseInsensitive && doc.uri.toLowerCase() === uri.toLowerCase()) return doc
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
      const root = this._root || this._cwd
      input = input.replace(/\$\{(.*?)\}/g, (match: string, name: string) => {
        if (name.startsWith('env:')) {
          let key = name.split(':')[1]
          let val = key ? process.env[key] : ''
          return val
        }
        switch (name) {
          case 'userHome':
            return os.homedir()
          case 'workspace':
          case 'workspaceRoot':
          case 'workspaceFolder':
            return root
          case 'workspaceFolderBasename':
            return path.basename(root)
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
            let base = fsPath ? path.basename(fsPath) : ''
            return base ? base.slice(0, base.length - path.extname(base).length) : ''
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
  public get document(): Promise<Document | undefined> {
    if (this._currentResolve) {
      return new Promise<Document>(resolve => {
        this.resolves.push(resolve)
      })
    }
    this._currentResolve = true
    return new Promise<Document>(resolve => {
      this.nvim.eval(`coc#util#get_bufoptions(bufnr("%"),${this.config.maxFileSize})`).then((opts: any) => {
        let doc: Document | undefined
        if (opts != null) {
          this.creating.delete(opts.bufnr)
          doc = this._createDocument(opts)
        }
        this.resolveCurrent(doc)
        resolve(doc)
        this._currentResolve = false
      }, () => {
        resolve(undefined)
        this._currentResolve = false
      })
    })
  }

  private resolveCurrent(document: Document | undefined): void {
    if (this.resolves.length > 0) {
      while (this.resolves.length) {
        const fn = this.resolves.pop()
        if (fn) fn(document)
      }
    }
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
    for (let doc of this.attached()) {
      res.add(doc.filetype)
    }
    return res
  }

  /**
   * Get filetype by check same extension name buffer.
   */
  public getLanguageId(filepath: string): string {
    let ext = path.extname(filepath)
    if (!ext) return ''
    for (let doc of this.attached()) {
      let fsPath = URI.parse(doc.uri).fsPath
      if (path.extname(fsPath) == ext) {
        return doc.languageId
      }
    }
    return ''
  }

  public async getLines(uri: string): Promise<readonly string[]> {
    let doc = this.getDocument(uri)
    if (doc) return doc.textDocument.lines
    let u = URI.parse(uri)
    if (u.scheme !== 'file') return []
    try {
      let content = await readFile(u.fsPath, 'utf8')
      return content.split(/\r?\n/)
    } catch (e) {
      return []
    }
  }

  /**
   * Current languageIds.
   */
  public get languageIds(): Set<string> {
    let res = new Set<string>()
    for (let doc of this.attached()) {
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

  /**
   * Create document by bufnr.
   */
  public async createDocument(bufnr: number): Promise<Document | undefined> {
    let doc = this.buffers.get(bufnr)
    if (doc) return doc
    if (this.creating.has(bufnr)) return await this.creating.get(bufnr)
    let promise = new Promise<Document | undefined>(resolve => {
      this.nvim.call('coc#util#get_bufoptions', [bufnr, this.config.maxFileSize]).then(opts => {
        if (!this.creating.has(bufnr)) {
          resolve(undefined)
          return
        }
        this.creating.delete(bufnr)
        if (!opts) {
          resolve(undefined)
          return
        }
        doc = this._createDocument(opts as BufferOption)
        resolve(doc)
      }, () => {
        this.creating.delete(bufnr)
        resolve(undefined)
      })
    })
    this.creating.set(bufnr, promise)
    return await promise
  }

  public async onBufCreate(bufnr: number): Promise<void> {
    this.onBufUnload(bufnr)
    await this.createDocument(bufnr)
  }

  private _createDocument(opts: BufferOption): Document {
    let { bufnr } = opts
    if (this.buffers.has(bufnr)) return this.buffers.get(bufnr)
    let buffer = this.nvim.createBuffer(bufnr)
    let doc = new Document(buffer, this._env, this.nvim, opts)
    if (opts.size > this.config.maxFileSize) logger.warn(`buffer ${opts.bufnr} size exceed maxFileSize ${this.config.maxFileSize}, not attached.`)
    this.buffers.set(bufnr, doc)
    if (doc.attached) {
      if (doc.schema == 'file') {
        // TODO use workspaceFolder for root when exists
        this.configurations.locateFolderConfigution(doc.uri)
        let root = this.workspaceFolder.resolveRoot(doc, this._cwd, true, this.expand.bind(this))
        if (root && bufnr == this._bufnr) this.changeRoot(root)
      }
      this._onDidOpenTextDocument.fire(doc.textDocument)
      doc.onDocumentChange(e => this._onDidChangeDocument.fire(e))
    }
    logger.debug('buffer created', bufnr, doc.attached, doc.uri)
    return doc
  }

  private onBufEnter(bufnr: number): void {
    this._bufnr = bufnr
    let doc = this.buffers.get(bufnr)
    if (doc) {
      let workspaceFolder = this.workspaceFolder.getWorkspaceFolder(URI.parse(doc.uri))
      if (workspaceFolder) this._root = URI.parse(workspaceFolder.uri).fsPath
    }
  }

  private onBufUnload(bufnr: number): void {
    this.creating.delete(bufnr)
    void this.onBufDetach(bufnr, false)
  }

  private async onBufDetach(bufnr: number, checkReload = true): Promise<void> {
    this.detachBuffer(bufnr)
    if (checkReload) {
      let loaded = await this.nvim.call('bufloaded', [bufnr])
      if (loaded) await this.createDocument(bufnr)
    }
  }

  public detachBuffer(bufnr: number): void {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    logger.debug('document detach', bufnr, doc.uri)
    this._onDidCloseDocument.fire(doc.textDocument)
    this.buffers.delete(bufnr)
    doc.detach()
  }

  private async onBufWritePost(bufnr: number, changedtick: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (doc) {
      if (doc.changedtick != changedtick) await doc.patchChange()
      this._onDidSaveDocument.fire(doc.textDocument)
    }
  }

  private async onBufWritePre(bufnr: number, bufname: string, changedtick: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc || !doc.attached) return
    if (doc.bufname != bufname) {
      this.detachBuffer(bufnr)
      doc = await this.createDocument(bufnr)
      if (!doc.attached) return
    }
    if (doc.changedtick != changedtick) {
      await doc.synchronize()
    } else {
      await doc.patchChange()
    }
    let firing = true
    let thenables: Thenable<TextEdit[] | any>[] = []
    let event: TextDocumentWillSaveEvent = {
      document: doc.textDocument,
      reason: TextDocumentSaveReason.Manual,
      waitUntil: (thenable: Thenable<any>) => {
        if (!firing) {
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
        const willSaveHandlerTimeout = this.config.willSaveHandlerTimeout
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
      if (edits) await doc.applyEdits(edits, false, this.bufnr === doc.bufnr)
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

  public async getQuickfixList(locations: LocationWithTarget[]): Promise<ReadonlyArray<QuickfixItem>> {
    let filesLines: { [fsPath: string]: string[] } = {}
    let filepathList = locations.reduce<string[]>((pre: string[], curr) => {
      let u = URI.parse(curr.uri)
      if (u.scheme == 'file' && !pre.includes(u.fsPath) && !this.getDocument(curr.uri)) {
        pre.push(u.fsPath)
      }
      return pre
    }, [])

    await Promise.all(filepathList.map(fsPath => {
      return new Promise<void>(resolve => {
        readFile(fsPath, 'utf8').then(content => {
          filesLines[fsPath] = content.split(/\r?\n/)
          resolve(undefined)
        }, () => {
          resolve()
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
   * Populate locations to UI.
   */
  public async showLocations(locations: LocationWithTarget[]): Promise<void> {
    let { nvim } = this
    let items = await this.getQuickfixList(locations)
    if (this.config.useQuickfixForLocations) {
      let openCommand = await nvim.getVar('coc_quickfix_open_command') as string
      if (typeof openCommand != 'string') {
        openCommand = items.length < 10 ? `copen ${items.length}` : 'copen'
      }
      nvim.pauseNotification()
      nvim.call('setqflist', [items], true)
      nvim.command(openCommand, true)
      nvim.resumeNotification(false, true)
    } else {
      await nvim.setVar('coc_jump_locations', items)
      if (this._env.locationlist) {
        nvim.command('CocList --normal --auto-preview location', true)
      } else {
        nvim.call('coc#util#do_autocmd', ['CocLocationsChange'], true)
      }
    }
  }

  /**
   * Convert location to quickfix item.
   */
  public async getQuickfixItem(loc: LocationWithTarget | LocationLink, text?: string, type = '', module?: string): Promise<QuickfixItem> {
    let targetRange = loc.targetRange
    if (LocationLink.is(loc)) {
      loc = Location.create(loc.targetUri, loc.targetRange)
    }
    let doc = this.getDocument(loc.uri)
    let { uri, range } = loc
    let { start, end } = range
    let u = URI.parse(uri)
    if (!text && u.scheme == 'file') {
      text = await this.getLine(uri, start.line)
    }
    let endLine = start.line == end.line ? text : await this.getLine(uri, end.line)
    let item: QuickfixItem = {
      uri,
      filename: u.scheme == 'file' ? u.fsPath : uri,
      lnum: start.line + 1,
      end_lnum: end.line + 1,
      col: text ? byteIndex(text, start.character) + 1 : start.character + 1,
      end_col: endLine ? byteIndex(endLine, end.character) + 1 : end.character + 1,
      text: text || '',
      range
    }
    if (targetRange) item.targetRange = targetRange
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
    if (document && document.attached) return document.getline(line) || ''
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
    this.changeRoot(process.cwd())
  }

  private changeRoot(dir: string): void {
    this._root = normalizeFilePath(dir)
  }

  public dispose(): void {
    for (let bufnr of this.buffers.keys()) {
      this.onBufUnload(bufnr)
    }
    this._attached = false
    this.buffers.clear()
    disposeAll(this.disposables)
  }
}
