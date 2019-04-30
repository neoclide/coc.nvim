import { Buffer, NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import findUp from 'find-up'
import fs from 'fs'
import os from 'os'
import path from 'path'
import util from 'util'
import { CancellationTokenSource, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, DidChangeTextDocumentParams, Disposable, DocumentSelector, Emitter, Event, FormattingOptions, Location, LocationLink, Position, Range, RenameFile, RenameFileOptions, TextDocument, TextDocumentEdit, TextDocumentSaveReason, WorkspaceEdit, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import which from 'which'
import Configurations from './configuration'
import ConfigurationShape from './configuration/shape'
import events from './events'
import DB from './model/db'
import Task from './model/task'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import Mru from './model/mru'
import BufferChannel from './model/outputChannel'
import Resolver from './model/resolver'
import StatusLine from './model/status'
import TerminalModel from './model/terminal'
import WillSaveUntilHandler from './model/willSaveHandler'
import { TextDocumentContentProvider } from './provider'
import { Autocmd, ConfigurationChangeEvent, ConfigurationTarget, EditerState, Env, IWorkspace, KeymapOption, MapMode, MessageLevel, MsgTypes, OutputChannel, QuickfixItem, StatusBarItem, StatusItemOption, Terminal, TerminalOptions, TerminalResult, TextDocumentWillSaveEvent, WorkspaceConfiguration, LanguageServerConfig, PatternType } from './types'
import { isFile, readFile, readFileLine, renameAsync, resolveRoot, statAsync, writeFile } from './util/fs'
import { disposeAll, echoErr, echoMessage, echoWarning, getKeymapModifier, isRunning, mkdirp, runCommand, wait, isDocumentEdit } from './util/index'
import { score } from './util/match'
import { byteIndex, byteLength } from './util/string'
import Watchman from './watchman'
import uuid = require('uuid/v1')
import { distinct } from './util/array'

declare var __webpack_require__: any
declare var __non_webpack_require__: any
const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require
const logger = require('./util/logger')('workspace')
const CONFIG_FILE_NAME = 'coc-settings.json'
let NAME_SPACE = 1080

export class Workspace implements IWorkspace {
  public readonly nvim: Neovim
  public readonly version: string
  public readonly keymaps: Map<string, Function> = new Map()
  public bufnr: number
  private resolver: Resolver = new Resolver()
  private rootPatterns: Map<string, string[]> = new Map()
  private _workspaceFolders: WorkspaceFolder[] = []
  private messageLevel: MessageLevel
  private willSaveUntilHandler: WillSaveUntilHandler
  private statusLine: StatusLine
  private _insertMode = false
  private _env: Env
  private _root: string
  private _cwd = process.cwd()
  private _blocking = false
  private _initialized = false
  private _attached = false
  private buffers: Map<number, Document> = new Map()
  private autocmds: Map<number, Autocmd> = new Map()
  private terminals: Map<number, Terminal> = new Map()
  private creatingSources: Map<number, CancellationTokenSource> = new Map()
  private outputChannels: Map<string, OutputChannel> = new Map()
  private schemeProviderMap: Map<string, TextDocumentContentProvider> = new Map()
  private namespaceMap: Map<string, number> = new Map()
  private disposables: Disposable[] = []
  private setupDynamicAutocmd: Function & { clear(): void; }
  private watchedOptions: Set<string> = new Set()

  private _disposed = false
  private _onDidOpenDocument = new Emitter<TextDocument>()
  private _onDidCloseDocument = new Emitter<TextDocument>()
  private _onDidChangeDocument = new Emitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new Emitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new Emitter<TextDocument>()
  private _onDidChangeWorkspaceFolders = new Emitter<WorkspaceFoldersChangeEvent>()
  private _onDidChangeConfiguration = new Emitter<ConfigurationChangeEvent>()
  private _onDidWorkspaceInitialized = new Emitter<void>()
  private _onDidOpenTerminal = new Emitter<Terminal>()
  private _onDidCloseTerminal = new Emitter<Terminal>()

  public readonly onDidCloseTerminal: Event<Terminal> = this._onDidCloseTerminal.event
  public readonly onDidOpenTerminal: Event<Terminal> = this._onDidOpenTerminal.event
  public readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent> = this._onDidChangeWorkspaceFolders.event
  public readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidOpenDocument.event
  public readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidCloseDocument.event
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveDocument.event
  public readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent> = this._onDidChangeConfiguration.event
  public readonly onDidWorkspaceInitialized: Event<void> = this._onDidWorkspaceInitialized.event
  public readonly configurations: Configurations

  constructor() {
    let json = requireFunc('../package.json')
    this.version = json.version
    this.configurations = this.createConfigurations()
    this.willSaveUntilHandler = new WillSaveUntilHandler(this)
    this.setupDynamicAutocmd = debounce(() => {
      this._setupDynamicAutocmd().catch(e => {
        logger.error(e)
      })
    }, global.hasOwnProperty('__TEST__') ? 0 : 100)
    this.setMessageLevel()
  }

  public async init(): Promise<void> {
    let { nvim } = this
    this.statusLine = new StatusLine(nvim)
    this._env = await nvim.call('coc#util#vim_info') as Env
    this._insertMode = this._env.mode.startsWith('insert')
    if (this._env.workspaceFolders) {
      this._workspaceFolders = this._env.workspaceFolders.map(f => {
        return {
          uri: Uri.file(f).toString(),
          name: path.dirname(f)
        }
      })
    }
    this.checkProcess()
    this.configurations.updateUserConfig(this._env.config)
    events.on('InsertEnter', () => {
      this._insertMode = true
    }, null, this.disposables)
    events.on('InsertLeave', () => {
      this._insertMode = false
    }, null, this.disposables)
    events.on('BufEnter', this.onBufEnter, this, this.disposables)
    events.on('CursorMoved', this.onCursorMoved, this, this.disposables)
    events.on('DirChanged', this.onDirChanged, this, this.disposables)
    events.on('BufCreate', this.onBufCreate, this, this.disposables)
    events.on('BufUnload', this.onBufUnload, this, this.disposables)
    events.on('TermOpen', this.onBufCreate, this, this.disposables)
    events.on('TermClose', this.onBufUnload, this, this.disposables)
    events.on('BufWritePost', this.onBufWritePost, this, this.disposables)
    events.on('BufWritePre', this.onBufWritePre, this, this.disposables)
    events.on('FileType', this.onFileTypeChange, this, this.disposables)
    events.on('CursorHold', this.checkBuffer as any, this, this.disposables)
    events.on('TextChanged', this.checkBuffer as any, this, this.disposables)
    events.on('BufReadCmd', this.onBufReadCmd, this, this.disposables)
    events.on('VimResized', (columns, lines) => {
      Object.assign(this._env, { columns, lines })
    }, null, this.disposables)
    await this.attach()
    this.initVimEvents()
    this.configurations.onDidChange(e => {
      this._onDidChangeConfiguration.fire(e)
    }, null, this.disposables)

    this.watchOption('runtimepath', (_, newValue: string) => {
      this._env.runtimepath = newValue
    }, this.disposables)
    this.watchOption('iskeyword', (_, newValue: string) => {
      let doc = this.getDocument(this.bufnr)
      if (doc) doc.setIskeyword(newValue)
    }, this.disposables)
    this.watchOption('completeopt', async (_, newValue) => {
      this.env.completeOpt = newValue
      if (!this._attached) return
      if (this.insertMode) {
        let suggest = this.getConfiguration('suggest')
        if (suggest.get<string>('autoTrigger') == 'always') {
          console.error(`Some plugin change completeopt on insert mode!`) // tslint:disable-line
        }
      }
    }, this.disposables)
    this.watchGlobal('coc_enabled', async (oldValue, newValue) => {
      if (newValue == oldValue) return
      if (newValue == 1) {
        await this.attach()
      } else {
        await this.detach()
      }
    }, this.disposables)
    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async (uri: Uri) => {
        let channel = this.outputChannels.get(uri.path.slice(1))
        if (!channel) return ''
        nvim.pauseNotification()
        nvim.command('setlocal nospell nofoldenable wrap noswapfile', true)
        nvim.command('setlocal buftype=nofile bufhidden=hide', true)
        nvim.command('setfiletype log', true)
        await nvim.resumeNotification()
        return channel.content
      }
    }
    this.disposables.push(this.registerTextDocumentContentProvider('output', provider))
  }

  public getConfigFile(target: ConfigurationTarget): string {
    return this.configurations.getConfigFile(target)
  }

  /**
   * Register autocmd on vim.
   */
  public registerAutocmd(autocmd: Autocmd): Disposable {
    let id = this.autocmds.size + 1
    this.autocmds.set(id, autocmd)
    this.setupDynamicAutocmd()
    return Disposable.create(() => {
      this.autocmds.delete(id)
      this.setupDynamicAutocmd()
    })
  }

  /**
   * Watch for option change.
   */
  public watchOption(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void {
    let watching = this.watchedOptions.has(key)
    if (!watching) {
      this.watchedOptions.add(key)
      this.setupDynamicAutocmd()
    }
    let disposable = events.on('OptionSet', async (changed: string, oldValue: any, newValue: any) => {
      if (changed == key && callback) {
        await Promise.resolve(callback(oldValue, newValue))
      }
    })
    if (disposables) {
      disposables.push(
        Disposable.create(() => {
          disposable.dispose()
          if (watching) return
          this.watchedOptions.delete(key)
          this.setupDynamicAutocmd()
        })
      )
    }
  }

  /**
   * Watch global variable, works on neovim only.
   */
  public watchGlobal(key: string, callback?: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void {
    let { nvim } = this
    nvim.call('coc#_watch', key, true)
    let disposable = events.on('GlobalChange', async (changed: string, oldValue: any, newValue: any) => {
      if (changed == key && callback) {
        await Promise.resolve(callback(oldValue, newValue))
      }
    })
    if (disposables) {
      disposables.push(
        Disposable.create(() => {
          disposable.dispose()
          nvim.call('coc#_unwatch', key, true)
        })
      )
    }
  }

  public get cwd(): string {
    return this._cwd
  }

  public get env(): Env {
    return this._env
  }

  public get root(): string {
    return this._root || this.cwd
  }

  public get rootPath(): string {
    return this.root
  }

  public get workspaceFolders(): WorkspaceFolder[] {
    return this._workspaceFolders
  }

  /**
   * uri of current file, could be null
   */
  public get uri(): string {
    let { bufnr } = this
    if (bufnr) {
      let document = this.getDocument(bufnr)
      if (document && document.schema == 'file') {
        return document.uri
      }
    }
    return null
  }

  public get workspaceFolder(): WorkspaceFolder {
    let { rootPath } = this
    if (rootPath == os.homedir()) return null
    return {
      uri: Uri.file(rootPath).toString(),
      name: path.basename(rootPath)
    }
  }

  public get textDocuments(): TextDocument[] {
    let docs = []
    for (let b of this.buffers.values()) {
      docs.push(b.textDocument)
    }
    return docs
  }

  public get documents(): Document[] {
    return Array.from(this.buffers.values())
  }

  public createNameSpace(name = ''): number {
    if (this.namespaceMap.has(name)) return this.namespaceMap.get(name)
    NAME_SPACE = NAME_SPACE + 1
    this.namespaceMap.set(name, NAME_SPACE)
    return NAME_SPACE
  }

  public get channelNames(): string[] {
    return Array.from(this.outputChannels.keys())
  }

  public get pluginRoot(): string {
    return path.dirname(__dirname)
  }

  public get isVim(): boolean {
    return this._env.isVim
  }

  public get isNvim(): boolean {
    return !this._env.isVim
  }

  public get completeOpt(): string {
    return this._env.completeOpt
  }

  public get initialized(): boolean {
    return this._initialized
  }

  public get ready(): Promise<void> {
    if (this._initialized) return Promise.resolve()
    return new Promise<void>(resolve => {
      let disposable = this.onDidWorkspaceInitialized(() => {
        disposable.dispose()
        resolve()
      })
    })
  }

  /**
   * Current filetypes.
   */
  public get filetypes(): Set<string> {
    let res = new Set() as Set<string>
    for (let doc of this.documents) {
      res.add(doc.filetype)
    }
    return res
  }

  /**
   * Check if selector match document.
   */
  public match(selector: DocumentSelector, document: TextDocument): number {
    return score(selector, document.uri, document.languageId)
  }

  /**
   * Findup for filename or filenames from current filepath or root.
   */
  public async findUp(filename: string | string[]): Promise<string | null> {
    let { cwd } = this

    let filepath = await this.nvim.call('expand', '%:p') as string
    filepath = path.normalize(filepath)
    let isFile = filepath && path.isAbsolute(filepath)
    if (isFile && !filepath.startsWith(cwd)) {
      // can't use cwd
      return await findUp(filename, { cwd: path.dirname(filepath) })
    }
    let res = await findUp(filename, { cwd })
    if (res && res != os.homedir()) return res
    if (isFile) return findUp(filename, { cwd: path.dirname(filepath) })
    return null
  }

  public async resolveRootFolder(uri: Uri, patterns: string[]): Promise<string> {
    let { cwd } = this
    if (uri.scheme != 'file') return cwd
    let filepath = path.normalize(uri.fsPath)
    let dir = path.dirname(filepath)
    return resolveRoot(dir, patterns) || dir
  }

  /**
   * Create a FileSystemWatcher instance,
   * doesn't fail when watchman not found.
   */
  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher {
    let watchmanPath = process.env.NODE_ENV == 'test' ? null : this.getWatchmanPath()
    let channel: OutputChannel = watchmanPath ? this.createOutputChannel('watchman') : null
    let promise = watchmanPath ? Watchman.createClient(watchmanPath, this.root, channel) : Promise.resolve(null)
    let watcher = new FileSystemWatcher(
      promise,
      globPattern,
      !!ignoreCreate,
      !!ignoreChange,
      !!ignoreDelete
    )
    return watcher
  }

  public getWatchmanPath(): string | null {
    const preferences = this.getConfiguration('coc.preferences')
    let watchmanPath = preferences.get<string>('watchmanPath', 'watchman')
    try {
      return which.sync(watchmanPath)
    } catch (e) {
      return null
    }
  }

  /**
   * Get configuration by section and optional resource uri.
   */
  public getConfiguration(section?: string, resource?: string): WorkspaceConfiguration {
    return this.configurations.getConfiguration(section, resource)
  }

  /**
   * Get created document by uri or bufnr.
   */
  public getDocument(uri: number | string): Document {
    if (typeof uri === 'number') {
      return this.buffers.get(uri)
    }
    uri = Uri.parse(uri).toString()
    for (let doc of this.buffers.values()) {
      if (doc && doc.uri === uri) return doc
    }
    return null
  }

  /**
   * Get current cursor offset in document.
   */
  public async getOffset(): Promise<number> {
    let document = await this.document
    let pos = await this.getCursorPosition()
    return document.textDocument.offsetAt(pos)
  }

  /**
   * Apply WorkspaceEdit.
   */
  public async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    let { nvim } = this
    let { documentChanges, changes } = edit
    if (documentChanges) {
      documentChanges = this.mergeDocumentChanges(documentChanges)
      if (!this.validteDocumentChanges(documentChanges)) return false
    }
    let curpos = await nvim.call('getcurpos')
    // let origIgnore = await nvim.getOption('eventignore') as string
    // await nvim.setOption('eventignore', 'Syntax')
    try {
      if (changes) {
        for (let uri of Object.keys(changes)) {
          let document = await this.loadFile(uri)
          await document.applyEdits(nvim, changes[uri])
        }
        this.showMessage(`${Object.keys(changes).length} buffers changed.`)
      }
      if (documentChanges && documentChanges.length) {
        let n = documentChanges.length
        for (let change of documentChanges) {
          if (isDocumentEdit(change)) {
            let { textDocument, edits } = change as TextDocumentEdit
            let doc = await this.loadFile(textDocument.uri)
            await doc.applyEdits(nvim, edits)
          } else if (CreateFile.is(change)) {
            let file = Uri.parse(change.uri).fsPath
            await this.createFile(file, change.options)
          } else if (RenameFile.is(change)) {
            await this.renameFile(Uri.parse(change.oldUri).fsPath, Uri.parse(change.newUri).fsPath, change.options)
          } else if (DeleteFile.is(change)) {
            await this.deleteFile(Uri.parse(change.uri).fsPath, change.options)
          }
        }
        this.showMessage(`${n} buffers changed.`)
      }
      await nvim.call('setpos', ['.', curpos])
    } catch (e) {
      // await nvim.setOption('eventignore', origIgnore)
      this.showMessage(`Error on applyEdits: ${e}`, 'error')
      return false
    }
    return true
  }

  /**
   * Convert location to quickfix item.
   */
  public async getQuickfixItem(loc: Location | LocationLink, text?: string, type = ''): Promise<QuickfixItem> {
    let { cwd, nvim } = this
    if (LocationLink.is(loc)) {
      loc = Location.create(loc.targetUri, loc.targetRange)
    }
    let { uri, range } = loc
    let { line, character } = range.start
    let u = Uri.parse(uri)
    let bufname = u.scheme == 'file' ? u.fsPath : uri
    let bufnr = await nvim.call('bufnr', bufname)
    if (!text && u.scheme == 'file') {
      text = await this.getLine(uri, line)
      character = byteIndex(text, character)
    }
    let item: QuickfixItem = {
      uri,
      filename: bufname.startsWith(cwd) ? path.relative(cwd, bufname) : bufname,
      lnum: line + 1,
      col: character + 1,
      text: text || '',
      range
    }
    if (type) item.type = type
    if (bufnr != -1) item.bufnr = bufnr
    return item
  }

  /**
   * Create persistence Mru instance.
   */
  public createMru(name: string): Mru {
    return new Mru(name)
  }

  public async getSelectedRange(mode: string, document: TextDocument): Promise<Range | null> {
    let { nvim } = this
    if (['v', 'V', 'char', 'line'].indexOf(mode) == -1) {
      this.showMessage(`Mode '${mode}' is not supported`, 'error')
      return null
    }
    let isVisual = ['v', 'V'].indexOf(mode) != -1
    let c = isVisual ? '<' : '['
    await nvim.command('normal! `' + c)
    let start = await this.getOffset()
    c = isVisual ? '>' : ']'
    await nvim.command('normal! `' + c)
    let end = await this.getOffset() + 1
    if (start == null || end == null || start == end) {
      this.showMessage(`Failed to get selected range`, 'error')
      return
    }
    return {
      start: document.positionAt(start),
      end: document.positionAt(end)
    }
  }

  /**
   * Populate locations to UI.
   */
  public async showLocations(locations: Location[]): Promise<void> {
    let items = await Promise.all(locations.map(loc => {
      return this.getQuickfixItem(loc)
    }))
    let { nvim } = this
    const preferences = this.getConfiguration('coc.preferences')
    if (preferences.get<boolean>('useQuickfixForLocations', false)) {
      await nvim.call('setqflist', [items])
      nvim.command('copen', true)
    } else {
      await nvim.setVar('coc_jump_locations', items)
      await nvim.command('doautocmd User CocLocationsChange')
    }
  }

  /**
   * Get content of line by uri and line.
   */
  public async getLine(uri: string, line: number): Promise<string> {
    let document = this.getDocument(uri)
    if (document) return document.getline(line) || ''
    if (!uri.startsWith('file:')) return ''
    return await readFileLine(Uri.parse(uri).fsPath, line)
  }

  /**
   * Get WorkspaceFolder of uri
   */
  public getWorkspaceFolder(uri: string): WorkspaceFolder | null {
    return this.workspaceFolders.find(f => uri.startsWith(f.uri))
  }

  /**
   * Get content from buffer of file by uri.
   */
  public async readFile(uri: string): Promise<string> {
    let document = this.getDocument(uri)
    if (document) {
      document.forceSync()
      return document.content
    }
    let u = Uri.parse(uri)
    if (u.scheme != 'file') return ''
    let encoding = await this.getFileEncoding()
    return await readFile(u.fsPath, encoding)
  }

  public onWillSaveUntil(callback: (event: TextDocumentWillSaveEvent) => void, thisArg: any, clientId: string): Disposable {
    return this.willSaveUntilHandler.addCallback(callback, thisArg, clientId)
  }

  /**
   * Echo lines.
   */
  public async echoLines(lines: string[], truncate = false): Promise<void> {
    let { nvim } = this
    let cmdHeight = this.env.cmdheight
    if (lines.length > cmdHeight && truncate) {
      lines = lines.slice(0, cmdHeight)
    }
    let maxLen = this.env.columns - 12
    lines = lines.map(line => {
      line = line.replace(/\n/g, ' ')
      if (truncate) line = line.slice(0, maxLen)
      return line
    })
    if (truncate && lines.length == cmdHeight) {
      let last = lines[lines.length - 1]
      lines[cmdHeight - 1] = `${last.length == maxLen ? last.slice(0, -4) : last} ...`
    }
    nvim.callTimer('coc#util#echo_lines', [lines], true)
  }

  /**
   * Show message in vim.
   */
  public showMessage(msg: string, identify: MsgTypes = 'more'): void {
    if (this._blocking || !this.nvim) return
    let { messageLevel } = this
    let level = MessageLevel.Error
    let method = echoErr
    switch (identify) {
      case 'more':
        level = MessageLevel.More
        method = echoMessage
        break
      case 'warning':
        level = MessageLevel.Warning
        method = echoWarning
        break
    }
    if (level >= messageLevel) {
      method(this.nvim, msg)
    }
  }

  /**
   * Current document.
   */
  public get document(): Promise<Document> {
    let { bufnr } = this
    if (bufnr == null) return null
    if (this.buffers.has(bufnr)) {
      return Promise.resolve(this.buffers.get(bufnr))
    }
    if (!this.creatingSources.has(bufnr)) {
      this.onBufCreate(bufnr).catch(e => {
        logger.error('Error on buffer create:', e)
      })
    }
    return new Promise<Document>(resolve => {
      let disposable = this.onDidOpenTextDocument(doc => {
        disposable.dispose()
        resolve(this.getDocument(doc.uri))
      })
    })
  }

  /**
   * Get current cursor position.
   */
  public async getCursorPosition(): Promise<Position> {
    let [line, character] = await this.nvim.call('coc#util#cursor')
    return Position.create(line, character)
  }

  /**
   * Get current document and position.
   */
  public async getCurrentState(): Promise<EditerState> {
    let document = await this.document
    let position = await this.getCursorPosition()
    return {
      document: document.textDocument,
      position
    }
  }

  /**
   * Get format options
   */
  public async getFormatOptions(uri?: string): Promise<FormattingOptions> {
    let doc: Document
    if (uri) {
      doc = this.getDocument(uri)
    } else {
      doc = this.getDocument(this.bufnr)
    }
    let tabSize = await this.getDocumentOption('shiftwidth', doc) as number
    if (!tabSize) tabSize = await this.getDocumentOption('tabstop', doc) as number
    let insertSpaces = (await this.getDocumentOption('expandtab', doc)) == 1
    return {
      tabSize,
      insertSpaces
    } as FormattingOptions
  }

  /**
   * Jump to location.
   */
  public async jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void> {
    const preferences = this.getConfiguration('coc.preferences')
    let jumpCommand = openCommand || preferences.get<string>('jumpCommand', 'edit')
    let { nvim } = this
    let { line, character } = position || { line: 0, character: 0 }
    let doc = this.getDocument(uri)
    let col = character + 1
    if (doc) col = byteLength(doc.getline(line).slice(0, character)) + 1
    let u = Uri.parse(uri)
    let bufname = u.scheme == 'file' ? u.fsPath : uri
    await nvim.command(`normal! m'`)
    let loaded = await nvim.call('bufloaded', bufname)
    let bufnr = loaded == 0 ? -1 : await nvim.call('bufnr', bufname)
    let method = this.isVim ? 'callTimer' : 'call'
    if (bufnr == this.bufnr && position && jumpCommand == 'edit') {
      await nvim.call('cursor', [line + 1, col])
    } else if (bufnr != -1 && jumpCommand == 'edit') {
      let moveCmd = position ? `+call\\ cursor(${line + 1},${col})` : ''
      await nvim[method]('coc#util#execute', [`buffer ${moveCmd} ${bufnr}`])
    } else {
      let cwd = await nvim.call('getcwd')
      let file = bufname.startsWith(cwd) ? path.relative(cwd, bufname) : bufname
      file = await nvim.call('fnameescape', file)
      let moveCmd = position ? `+call\\ cursor(${line + 1},${col})` : ''
      await nvim[method]('coc#util#execute', [`${jumpCommand} ${moveCmd} ${file}`])
    }
    if (this.isVim) await wait(100)
  }

  /**
   * Move cursor to position.
   */
  public async moveTo(position: Position): Promise<void> {
    let { nvim } = this
    let line = await nvim.call('getline', position.line + 1)
    let col = byteLength(line.slice(0, position.character)) + 1
    await nvim.call('cursor', [position.line + 1, col])
  }

  /**
   * Create a file in vim and disk
   */
  public async createFile(filepath: string, opts: CreateFileOptions = {}): Promise<void> {
    let stat = await statAsync(filepath)
    if (stat && !opts.overwrite && !opts.ignoreIfExists) {
      this.showMessage(`${filepath} already exists!`, 'error')
      return
    }
    if (!stat || opts.overwrite) {
      // directory
      if (filepath.endsWith('/')) {
        try {
          if (filepath.startsWith('~')) filepath = filepath.replace(/^~/, os.homedir())
          await mkdirp(filepath)
        } catch (e) {
          this.showMessage(`Can't create ${filepath}: ${e.message}`, 'error')
        }
      } else {
        let uri = Uri.file(filepath).toString()
        let doc = this.getDocument(uri)
        if (doc) return
        let encoding = await this.getFileEncoding()
        fs.writeFileSync(filepath, '', encoding || '')
        await this.loadFile(uri)
      }
    }
  }

  /**
   * Load uri as document.
   */
  public async loadFile(uri: string): Promise<Document> {
    let u = Uri.parse(uri)
    let doc = this.getDocument(uri)
    if (doc) return doc
    let { nvim } = this
    let filepath = u.scheme == 'file' ? u.fsPath : uri
    let escaped = await nvim.call('fnameescape', filepath)
    let bufnr = await nvim.call('bufnr', '%')
    nvim.pauseNotification()
    nvim.command('setl bufhidden=hide', true)
    nvim.command(`keepalt edit ${escaped}`, true)
    nvim.command('setl bufhidden=hide', true)
    nvim.command(`keepalt buffer ${bufnr}`, true)
    return await new Promise<Document>((resolve, reject) => {
      let disposable = this.onDidOpenTextDocument(textDocument => {
        if (textDocument.uri == uri) {
          clearTimeout(timer)
          disposable.dispose()
          resolve(this.getDocument(uri))
        }
      })
      let timer = setTimeout(() => {
        disposable.dispose()
        reject(new Error(`Create document ${uri} timeout after 1s.`))
      }, 1000)
      nvim.resumeNotification(false, true).catch(_e => {
        // noop
      })
    })
  }

  /**
   * Rename file in vim and disk
   */
  public async renameFile(oldPath: string, newPath: string, opts: RenameFileOptions = {}): Promise<void> {
    let { overwrite, ignoreIfExists } = opts
    let stat = await statAsync(newPath)
    if (stat && !overwrite && !ignoreIfExists) {
      this.showMessage(`${newPath} already exists`, 'error')
      return
    }
    if (!stat || overwrite) {
      try {
        await renameAsync(oldPath, newPath)
        let uri = Uri.file(oldPath).toString()
        let doc = this.getDocument(uri)
        if (doc) {
          await doc.buffer.setName(newPath)
          // avoid cancel by unload
          await this.onBufCreate(doc.bufnr)
        }
      } catch (e) {
        this.showMessage(`Rename error ${e.message}`, 'error')
      }
    }
  }

  /**
   * Delete file from vim and disk.
   */
  public async deleteFile(filepath: string, opts: DeleteFileOptions = {}): Promise<void> {
    let { ignoreIfNotExists, recursive } = opts
    let stat = await statAsync(filepath.replace(/\/$/, ''))
    let isDir = stat && stat.isDirectory() || filepath.endsWith('/')
    if (!stat && !ignoreIfNotExists) {
      this.showMessage(`${filepath} not exists`, 'error')
      return
    }
    if (stat == null) return
    if (isDir && !recursive) {
      this.showMessage(`Can't remove directory, recursive not set`, 'error')
      return
    }
    try {
      let method = isDir ? 'rmdir' : 'unlink'
      await util.promisify(fs[method])(filepath)
      if (!isDir) {
        let uri = Uri.file(filepath).toString()
        let doc = this.getDocument(uri)
        if (doc) await this.nvim.command(`silent bwipeout ${doc.bufnr}`)
      }
    } catch (e) {
      this.showMessage(`Error on delete ${filepath}: ${e.message}`, 'error')
    }
  }

  /**
   * Open resource by uri
   */
  public async openResource(uri: string): Promise<void> {
    let { nvim } = this
    // not supported
    if (uri.startsWith('http')) {
      await nvim.call('coc#util#open_url', uri)
      return
    }
    let wildignore = await nvim.getOption('wildignore')
    await nvim.setOption('wildignore', '')
    await this.jumpTo(uri)
    await nvim.setOption('wildignore', wildignore)
  }

  /**
   * Create a new output channel
   */
  public createOutputChannel(name: string): OutputChannel {
    if (this.outputChannels.has(name)) return this.outputChannels.get(name)
    let channel = new BufferChannel(name, this.nvim)
    this.outputChannels.set(name, channel)
    return channel
  }

  /**
   * Reveal buffer of output channel.
   */
  public showOutputChannel(name: string): void {
    let channel = this.outputChannels.get(name)
    if (!channel) {
      this.showMessage(`Channel "${name}" not found`, 'error')
      return
    }
    channel.show(false)
  }

  /**
   * Resovle module from yarn or npm.
   */
  public async resolveModule(name: string): Promise<string> {
    return await this.resolver.resolveModule(name)
  }

  /**
   * Run nodejs command
   */
  public async runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string> {
    cwd = cwd || this.cwd
    return runCommand(cmd, { cwd }, timeout)
  }

  /**
   * Run command in vim terminal
   */
  public async runTerminalCommand(cmd: string, cwd = this.cwd, keepfocus = false): Promise<TerminalResult> {
    return await this.nvim.callAsync('coc#util#run_terminal', { cmd, cwd, keepfocus: keepfocus ? 1 : 0 }) as TerminalResult
  }

  public async createTerminal(opts: TerminalOptions): Promise<Terminal> {
    let cmd = opts.shellPath
    let args = opts.shellArgs
    if (!cmd) cmd = await this.nvim.getOption('shell') as string
    let terminal = new TerminalModel(cmd, args || [], this.nvim, opts.name)
    await terminal.start(opts.cwd || this.cwd, opts.env)
    this.terminals.set(terminal.bufnr, terminal)
    this._onDidOpenTerminal.fire(terminal)
    return terminal
  }

  /**
   * Show quickpick
   */
  public async showQuickpick(items: string[], placeholder = 'Choose by number'): Promise<number> {
    let msgs = [placeholder + ':']
    msgs = msgs.concat(items.map((str, index) => {
      return `${index + 1}. ${str}`
    }))
    let res = await this.nvim.call('inputlist', [msgs])
    let n = parseInt(res, 10)
    if (isNaN(n) || n <= 0 || n > msgs.length) return -1
    return n - 1
  }

  /**
   * Prompt for confirm action.
   */
  public async showPrompt(title: string): Promise<boolean> {
    this._blocking = true
    let res = await this.nvim.callAsync('coc#util#with_callback', ['coc#util#prompt_confirm', [title]])
    this._blocking = false
    return res == 1
  }

  /**
   * Request input from user
   */
  public async requestInput(title: string, defaultValue?: string): Promise<string> {
    let { nvim } = this
    let res = await nvim.call('input', [title + ':', defaultValue || ''])
    nvim.command('normal! :<C-u>', true)
    if (!res) {
      this.showMessage('Empty word, canceled', 'warning')
      return null
    }
    return res
  }

  /**
   * registerTextDocumentContentProvider
   */
  public registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable {
    this.schemeProviderMap.set(scheme, provider)
    this.setupDynamicAutocmd() // tslint:disable-line
    let disposables: Disposable[] = []
    if (provider.onDidChange) {
      provider.onDidChange(async uri => {
        let doc = this.getDocument(uri.toString())
        if (doc) {
          let { buffer } = doc
          let tokenSource = new CancellationTokenSource()
          let content = await Promise.resolve(provider.provideTextDocumentContent(uri, tokenSource.token))
          await buffer.setLines(content.split('\n'), {
            start: 0,
            end: -1,
            strictIndexing: false
          })
        }
      }, null, disposables)
    }
    return Disposable.create(() => {
      this.schemeProviderMap.delete(scheme)
      disposeAll(disposables)
      this.setupDynamicAutocmd()
    })
  }

  /**
   * Register keymap
   */
  public registerKeymap(modes: MapMode[], key: string, fn: Function, opts: Partial<KeymapOption> = {}): Disposable {
    if (this.keymaps.has(key)) return
    opts = Object.assign({ sync: true, cancel: true, silent: true }, opts)
    let { nvim } = this
    this.keymaps.set(key, fn)
    let method = opts.sync ? 'request' : 'notify'
    let silent = opts.silent ? '<silent>' : ''
    for (let m of modes) {
      if (m == 'i') {
        nvim.command(`imap ${silent}<expr> <Plug>(coc-${key}) coc#_insert_key('${method}', '${key}', ${opts.cancel ? 1 : 0})`, true)
      } else {
        let modify = this.isNvim ? '<Cmd>' : getKeymapModifier(m)
        nvim.command(`${m}map ${silent} <Plug>(coc-${key}) ${modify}:call coc#rpc#${method}('doKeymap', ['${key}'])<cr>`, true)
      }
    }
    return Disposable.create(() => {
      this.keymaps.delete(key)
      for (let m of modes) {
        nvim.command(`${m}unmap <Plug>(coc-${key})`, true)
      }
    })
  }

  /**
   * Register expr keymap.
   */
  public registerExprKeymap(mode: 'i' | 'n' | 'v' | 's' | 'x', key: string, fn: Function, buffer = false): Disposable {
    let id = uuid()
    let { nvim } = this
    this.keymaps.set(id, fn)
    if (mode == 'i') {
      nvim.command(`inoremap <silent><expr>${buffer ? '<nowait><buffer>' : ''} ${key} coc#_insert_key('request', '${id}')`, true)
    } else {
      nvim.command(`${mode}noremap <silent><expr>${buffer ? '<nowait><buffer>' : ''} ${key} coc#rpc#request('doKeymap', ['${id}'])`, true)
    }
    return Disposable.create(() => {
      this.keymaps.delete(id)
      nvim.command(`${mode}unmap ${buffer ? '<buffer>' : ''} ${key}`, true)
    })
  }

  /**
   * Create StatusBarItem
   */
  public createStatusBarItem(priority = 0, opt: StatusItemOption = {}): StatusBarItem {
    if (!this.statusLine) return null
    return this.statusLine.createStatusBarItem(priority, opt.progress || false)
  }

  public dispose(): void {
    this._disposed = true
    for (let ch of this.outputChannels.values()) {
      ch.dispose()
    }
    for (let doc of this.documents) {
      doc.detach()
    }
    disposeAll(this.disposables)
    Watchman.dispose()
    this.configurations.dispose()
    this.setupDynamicAutocmd.clear()
    this.buffers.clear()
    if (this.statusLine) this.statusLine.dispose()
  }

  public async detach(): Promise<void> {
    if (!this._attached) return
    this._attached = false
    for (let bufnr of this.buffers.keys()) {
      await events.fire('BufUnload', [bufnr])
    }
  }

  /**
   * Create DB instance at extension root.
   */
  public createDatabase(name: string): DB {
    let root = path.dirname(this.env.extensionRoot)
    let filepath = path.join(root, name + '.json')
    return new DB(filepath)
  }

  /**
   * Create Task instance that runs in vim.
   */
  public createTask(id: string): Task {
    return new Task(this.nvim, id)
  }

  private async _setupDynamicAutocmd(): Promise<void> {
    let schemes = this.schemeProviderMap.keys()
    let cmds: string[] = []
    for (let scheme of schemes) {
      cmds.push(`autocmd BufReadCmd,FileReadCmd,SourceCmd ${scheme}://* call coc#rpc#request('CocAutocmd', ['BufReadCmd','${scheme}', expand('<amatch>')])`)
    }
    for (let [id, autocmd] of this.autocmds.entries()) {
      let args = autocmd.arglist && autocmd.arglist.length ? ', ' + autocmd.arglist.join(', ') : ''
      cmds.push(`autocmd ${autocmd.event} * call coc#rpc#${autocmd.request ? 'request' : 'notify'}('doAutocmd', [${id}${args}])`)
    }
    for (let key of this.watchedOptions) {
      cmds.push(`autocmd OptionSet ${key} call coc#rpc#notify('OptionSet',[expand('<amatch>'), v:option_old, v:option_new])`)
    }
    let content = `
augroup coc_autocmd
  autocmd!
  ${cmds.join('\n')}
augroup end`
    try {
      let filepath = path.join(os.tmpdir(), `coc-${process.pid}.vim`)
      await writeFile(filepath, content)
      await this.nvim.command(`source ${filepath}`)
    } catch (e) {
      this.showMessage(`Can't create tmp file: ${e.message}`, 'error')
    }
  }

  private async onBufReadCmd(scheme: string, uri: string): Promise<void> {
    let provider = this.schemeProviderMap.get(scheme)
    if (!provider) {
      this.showMessage(`Provider for ${scheme} not found`, 'error')
      return
    }
    let tokenSource = new CancellationTokenSource()
    let content = await Promise.resolve(provider.provideTextDocumentContent(Uri.parse(uri), tokenSource.token))
    let buf = await this.nvim.buffer
    await buf.setLines(content.split('\n'), {
      start: 0,
      end: -1,
      strictIndexing: false
    })
    setTimeout(async () => {
      await events.fire('BufCreate', [buf.id])
    }, 30)
  }

  private async attach(): Promise<void> {
    if (this._attached) return
    this._attached = true
    let buffers = await this.nvim.buffers
    let bufnr = this.bufnr = await this.nvim.call('bufnr', '%')
    await Promise.all(buffers.map(buf => {
      return this.onBufCreate(buf)
    }))
    if (!this._initialized) {
      this._onDidWorkspaceInitialized.fire(void 0)
      this._initialized = true
    }
    await events.fire('BufEnter', [bufnr])
    let winid = await this.nvim.call('win_getid')
    await events.fire('BufWinEnter', [bufnr, winid])
  }

  private validteDocumentChanges(documentChanges: any[] | null): boolean {
    if (!documentChanges) return true
    for (let change of documentChanges) {
      if (isDocumentEdit(change)) {
        let { textDocument } = change as TextDocumentEdit
        let { uri, version } = textDocument
        let doc = this.getDocument(uri)
        if (version && !doc) {
          this.showMessage(`${uri} not opened.`, 'error')
          return false
        }
        if (version && doc.version != version) {
          this.showMessage(`${uri} changed before apply edit`, 'error')
          return false
        }
        if (!version && !doc) {
          if (!uri.startsWith('file')) {
            this.showMessage(`Can't apply edits to ${uri}.`, 'error')
            return false
          }
          let exists = fs.existsSync(Uri.parse(uri).fsPath)
          if (!exists) {
            this.showMessage(`File ${uri} not exists.`, 'error')
            return false
          }
        }
      }
      else if (CreateFile.is(change) || DeleteFile.is(change)) {
        if (!isFile(change.uri)) {
          this.showMessage(`Chagne of scheme ${change.uri} not supported`, 'error')
          return false
        }
      }
    }
    return true
  }

  private createConfigurations(): Configurations {
    let home = process.env.VIMCONFIG || path.join(os.homedir(), '.vim')
    if (global.hasOwnProperty('__TEST__')) {
      home = path.join(this.pluginRoot, 'src/__tests__')
    }
    let userConfigFile = path.join(home, CONFIG_FILE_NAME)
    return new Configurations(userConfigFile, new ConfigurationShape(this))
  }

  // events for sync buffer of vim
  private initVimEvents(): void {
    if (!this.isVim) return
    const onChange = async (bufnr: number) => {
      let doc = this.getDocument(bufnr)
      if (doc) doc.fetchContent()
    }
    events.on('TextChangedI', onChange, null, this.disposables)
    events.on('TextChanged', onChange, null, this.disposables)
  }

  private async onBufCreate(buf: number | Buffer): Promise<void> {
    let buffer = typeof buf === 'number' ? this.nvim.createBuffer(buf) : buf
    let bufnr = buffer.id
    if (this.creatingSources.has(bufnr)) return
    let document = this.getDocument(bufnr)
    try {
      if (document) this.onBufUnload(bufnr, true)
      document = new Document(buffer, this._env)
      let source = new CancellationTokenSource()
      let token = source.token
      this.creatingSources.set(bufnr, source)
      let created = await document.init(this.nvim, token)
      if (!created) document = null
      if (this.creatingSources.get(bufnr) == source) {
        source.dispose()
        this.creatingSources.delete(bufnr)
      }
    } catch (e) {
      logger.error('Error on create buffer:', e)
    }
    if (!document) return
    this.buffers.set(bufnr, document)
    document.onDocumentDetach(uri => {
      let doc = this.getDocument(uri)
      if (doc) this.onBufUnload(doc.bufnr)
    })
    if (document.buftype == '' && document.schema == 'file') {
      let config = this.getConfiguration('workspace')
      let filetypes = config.get<string[]>('ignoredFiletypes', [])
      if (filetypes.indexOf(document.filetype) == -1) {
        let root = this.resolveRoot(document) || this.cwd
        this.addWorkspaceFolder(root)
        let workspaceFolder = this.getWorkspaceFolder(document.uri)
        if (this.bufnr == buffer.id && workspaceFolder) {
          this._root = Uri.parse(workspaceFolder.uri).fsPath
        }
      }
      this.configurations.checkFolderConfiguration(document.uri)
    }
    this._onDidOpenDocument.fire(document.textDocument)
    document.onDocumentChange(({ textDocument, contentChanges }) => {
      let { version, uri } = textDocument
      this._onDidChangeDocument.fire({
        textDocument: { version, uri },
        contentChanges
      })
    })
    logger.debug('buffer created', buffer.id)
  }

  private async onBufEnter(bufnr: number): Promise<void> {
    this.bufnr = bufnr
    let doc = this.getDocument(bufnr)
    if (doc) {
      this.configurations.setFolderConfiguration(doc.uri)
      let workspaceFolder = this.getWorkspaceFolder(doc.uri)
      if (workspaceFolder) this._root = Uri.parse(workspaceFolder.uri).fsPath
    }
  }

  private async onCursorMoved(bufnr: number): Promise<void> {
    this.bufnr = bufnr
    await this.checkBuffer(bufnr)
  }

  private async onBufWritePost(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    this._onDidSaveDocument.fire(doc.textDocument)
  }

  private onBufUnload(bufnr: number, recreate = false): void {
    if (!recreate) {
      let source = this.creatingSources.get(bufnr)
      if (source) {
        source.cancel()
        this.creatingSources.delete(bufnr)
      }
    }
    if (this.terminals.has(bufnr)) {
      let terminal = this.terminals.get(bufnr)
      this._onDidCloseTerminal.fire(terminal)
      this.terminals.delete(bufnr)
    }
    let doc = this.buffers.get(bufnr)
    if (doc) {
      this._onDidCloseDocument.fire(doc.textDocument)
      this.buffers.delete(bufnr)
      if (!recreate) doc.detach()
    }
    logger.debug('buffer unload', bufnr)
  }

  private async onBufWritePre(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    let event: TextDocumentWillSaveEvent = {
      document: doc.textDocument,
      reason: TextDocumentSaveReason.Manual
    }
    this._onWillSaveDocument.fire(event)
    if (this.willSaveUntilHandler.hasCallback) {
      await this.willSaveUntilHandler.handeWillSaveUntil(event)
    }
  }

  private onDirChanged(cwd: string): void {
    if (cwd == this._cwd) return
    this._cwd = cwd
  }

  private onFileTypeChange(filetype: string, bufnr: number): void {
    let doc = this.getDocument(bufnr)
    if (!doc) return
    let converted = doc.convertFiletype(filetype)
    if (converted == doc.filetype) return
    this._onDidCloseDocument.fire(doc.textDocument)
    doc.setFiletype(filetype)
    this._onDidOpenDocument.fire(doc.textDocument)
  }

  private async checkBuffer(bufnr: number): Promise<void> {
    if (this._disposed) return
    let doc = this.getDocument(bufnr)
    if (!doc && !this.creatingSources.has(bufnr)) await this.onBufCreate(bufnr)
  }

  private async getFileEncoding(): Promise<string> {
    let encoding = await this.nvim.getOption('fileencoding') as string
    return encoding ? encoding : 'utf-8'
  }

  private resolveRoot(document: Document): string {
    let types = [PatternType.Buffer, PatternType.LanguageServer, PatternType.Global]
    let u = Uri.parse(document.uri)
    let dir = path.dirname(u.fsPath)
    for (let patternType of types) {
      let patterns = this.getRootPatterns(document, patternType)
      if (patterns && patterns.length) {
        let root = resolveRoot(dir, patterns, this.cwd)
        if (root) return root
      }
    }
    if (this.cwd != os.homedir() && dir.startsWith(this.cwd)) return this.cwd
    return null
  }

  public getRootPatterns(document: Document, patternType: PatternType): string[] {
    let { uri } = document
    if (patternType == PatternType.Buffer) return document.rootPatterns
    if (patternType == PatternType.LanguageServer) return this.getServerRootPatterns(document.filetype)
    const preferences = this.getConfiguration('coc.preferences', uri)
    return preferences.get<string[]>('rootPatterns', ['.vim', '.git', '.hg', '.projections.json']).slice()
  }

  public async renameCurrent(): Promise<void> {
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', '%')
    let cwd = await nvim.call('getcwd')
    let doc = this.getDocument(bufnr)
    if (!doc || doc.buftype != '' || doc.schema != 'file') {
      nvim.errWriteLine('current buffer is not file.')
      return
    }
    let oldPath = Uri.parse(doc.uri).fsPath
    let newPath = await nvim.call('input', ['new path:', oldPath, 'file'])
    if (newPath == oldPath) return
    let lines = await doc.buffer.lines
    let exists = fs.existsSync(oldPath)
    if (exists) {
      let modified = await nvim.eval('&modified')
      if (modified) await nvim.command('noa w')
      if (oldPath.toLowerCase() != newPath.toLowerCase() && fs.existsSync(newPath)) {
        let overwrite = await this.showPrompt(`${newPath} exists, overwrite?`)
        if (!overwrite) return
        fs.unlinkSync(newPath)
      }
      fs.renameSync(oldPath, newPath)
    }
    let filepath = newPath.startsWith(cwd) ? path.relative(cwd, newPath) : newPath
    let cursor = await nvim.call('getcurpos')
    nvim.pauseNotification()
    nvim.command(`keepalt ${bufnr}bwipeout!`, true)
    nvim.call('coc#util#open_file', ['keepalt edit', filepath], true)
    if (!exists && lines.join('\n') != '\n') {
      nvim.call('append', [0, lines], true)
      nvim.command('normal! Gdd', true)
    }
    nvim.call('setpos', ['.', cursor], true)
    await nvim.resumeNotification()
  }

  private setMessageLevel(): void {
    let config = this.getConfiguration('coc.preferences')
    let level = config.get<string>('messageLevel', 'more')
    switch (level) {
      case 'error':
        this.messageLevel = MessageLevel.Error
        break
      case 'warning':
        this.messageLevel = MessageLevel.Warning
        break
      default:
        this.messageLevel = MessageLevel.More
    }
  }

  private mergeDocumentChanges(changes: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[]): any[] {
    let res: any[] = []
    let documentEdits: TextDocumentEdit[] = []
    for (let change of changes) {
      if (isDocumentEdit(change)) {
        let { edits, textDocument } = change as TextDocumentEdit
        let documentEdit = documentEdits.find(o => o.textDocument.uri == textDocument.uri && o.textDocument.version === textDocument.version)
        if (documentEdit) {
          documentEdit.edits.push(...edits)
        } else {
          documentEdits.push(change as TextDocumentEdit)
        }
      } else {
        res.push(change)
      }
    }
    res.push(...documentEdits)
    return res
  }

  public get folderPaths(): string[] {
    return this.workspaceFolders.map(f => Uri.parse(f.uri).fsPath)
  }

  public removeWorkspaceFolder(fsPath: string): void {
    let idx = this._workspaceFolders.findIndex(f => Uri.parse(f.uri).fsPath == fsPath)
    if (idx != -1) {
      let folder = this._workspaceFolders[idx]
      this._workspaceFolders.splice(idx, 1)
      this._onDidChangeWorkspaceFolders.fire({
        removed: [folder],
        added: []
      })
    }
  }

  public renameWorkspaceFolder(oldPath: string, newPath: string): void {
    let idx = this._workspaceFolders.findIndex(f => Uri.parse(f.uri).fsPath == oldPath)
    if (idx == -1) return
    let removed = this._workspaceFolders[idx]
    let added: WorkspaceFolder = {
      uri: Uri.file(newPath).toString(),
      name: path.dirname(newPath)
    }
    this._workspaceFolders.splice(idx, 1)
    this._workspaceFolders.push(added)
    this._onDidChangeWorkspaceFolders.fire({
      removed: [removed],
      added: [added]
    })
  }

  public addRootPatterns(filetype: string, rootPatterns: string[]): void {
    let patterns = this.rootPatterns.get(filetype) || []
    for (let p of rootPatterns) {
      if (patterns.indexOf(p) == -1) {
        patterns.push(p)
      }
    }
    this.rootPatterns.set(filetype, patterns)
  }

  public get insertMode(): boolean {
    return this._insertMode
  }

  private getDocumentOption(name: string, doc?: Document): Promise<any> {
    return doc ? doc.buffer.getOption(name) : this.nvim.getOption(name)
  }

  private checkProcess(): void {
    if (global.hasOwnProperty('__TEST__')) return
    let pid = this._env.pid
    let interval = setInterval(() => {
      if (!isRunning(pid)) {
        process.exit()
      }
    }, 15000)
    process.on('exit', () => {
      clearInterval(interval)
    })
  }

  private addWorkspaceFolder(rootPath: string): WorkspaceFolder {
    if (rootPath == os.homedir()) return
    let { _workspaceFolders } = this
    let uri = Uri.file(rootPath).toString()
    let workspaceFolder: WorkspaceFolder = { uri, name: path.basename(rootPath) }
    if (_workspaceFolders.findIndex(o => o.uri == uri) == -1) {
      _workspaceFolders.push(workspaceFolder)
      if (this._initialized) {
        this._onDidChangeWorkspaceFolders.fire({
          added: [workspaceFolder],
          removed: []
        })
      }
    }
    return workspaceFolder
  }

  private getServerRootPatterns(filetype: string): string[] {
    let lspConfig = this.getConfiguration().get<{ string: LanguageServerConfig }>('languageserver', {} as any)
    let patterns: string[] = []
    for (let key of Object.keys(lspConfig)) {
      let config: LanguageServerConfig = lspConfig[key]
      let { filetypes, rootPatterns } = config
      if (filetypes && rootPatterns && filetypes.indexOf(filetype) !== -1) {
        patterns.push(...rootPatterns)
      }
    }
    patterns = patterns.concat(this.rootPatterns.get(filetype) || [])
    return patterns.length ? distinct(patterns) : null
  }
}

export default new Workspace()
