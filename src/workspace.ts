import { Buffer, NeovimClient as Neovim } from '@chemzqm/neovim'
import { VimValue } from '@chemzqm/neovim/lib/types/VimValue'
import debounce from 'debounce'
import findUp from 'find-up'
import fs from 'fs'
import os from 'os'
import path from 'path'
import pify from 'pify'
import { CancellationTokenSource, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, DidChangeTextDocumentParams, Disposable, DocumentSelector, Emitter, Event, FormattingOptions, Location, Position, RenameFile, RenameFileOptions, TextDocument, TextDocumentEdit, TextDocumentSaveReason, WorkspaceEdit, WorkspaceFolder, LocationLink } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import which from 'which'
import Configurations from './configuration'
import ConfigurationShape from './configuration/shape'
import events from './events'
import Mru from './model/mru'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import BufferChannel from './model/outputChannel'
import Resolver from './model/resolver'
import StatusLine from './model/status'
import WillSaveUntilHandler from './model/willSaveHandler'
import { TextDocumentContentProvider } from './provider'
import { ConfigurationChangeEvent, ConfigurationTarget, EditerState, Env, ErrorItem, IWorkspace, MapMode, MessageLevel, MsgTypes, OutputChannel, QuickfixItem, StatusBarItem, StatusItemOption, TerminalResult, TextDocumentWillSaveEvent, WorkspaceConfiguration, Autocmd, KeymapOption } from './types'
import { isFile, mkdirAsync, readFile, readFileLine, renameAsync, resolveRoot, statAsync, writeFile } from './util/fs'
import { disposeAll, echoErr, echoMessage, echoWarning, runCommand, wait, getKeymapModifier, isRunning } from './util/index'
import { score } from './util/match'
import { byteIndex, byteLength } from './util/string'
import Watchman from './watchman'
import uuid = require('uuid/v1')
const logger = require('./util/logger')('workspace')
const CONFIG_FILE_NAME = 'coc-settings.json'
const isPkg = process.hasOwnProperty('pkg')

export class Workspace implements IWorkspace {
  public readonly nvim: Neovim
  public readonly version: string
  public bufnr: number
  public readonly keymaps: Map<string, Function> = new Map()
  private resolver: Resolver = new Resolver()

  private messageLevel: MessageLevel
  private willSaveUntilHandler: WillSaveUntilHandler
  private statusLine: StatusLine
  private _env: Env
  private _root: string
  private _cwd = process.cwd()
  private _blocking = false
  private _initialized = false
  private _attached = false
  private buffers: Map<number, Document> = new Map()
  private autocmds: Map<number, Autocmd> = new Map()
  private creating: Set<number> = new Set()
  private outputChannels: Map<string, OutputChannel> = new Map()
  private schemeProviderMap: Map<string, TextDocumentContentProvider> = new Map()
  private namespaceMap: Map<string, number> = new Map()
  private disposables: Disposable[] = []
  private checkBuffer: Function & { clear(): void; }
  private setupDynamicAutocmd: Function & { clear(): void; }
  private watchedOptions: Set<string> = new Set()

  private _disposed = false
  private _onDidOpenDocument = new Emitter<TextDocument>()
  private _onDidCloseDocument = new Emitter<TextDocument>()
  private _onDidChangeDocument = new Emitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new Emitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new Emitter<TextDocument>()
  private _onDidChangeWorkspaceFolder = new Emitter<WorkspaceFolder>()
  private _onDidChangeConfiguration = new Emitter<ConfigurationChangeEvent>()
  private _onDidWorkspaceInitialized = new Emitter<void>()

  public readonly onDidChangeWorkspaceFolder: Event<WorkspaceFolder> = this._onDidChangeWorkspaceFolder.event
  public readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidOpenDocument.event
  public readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidCloseDocument.event
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveDocument.event
  public readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent> = this._onDidChangeConfiguration.event
  public readonly onDidWorkspaceInitialized: Event<void> = this._onDidWorkspaceInitialized.event
  public readonly configurations: Configurations

  constructor() {
    let json = require('../package.json')
    this.version = json.version
    this.configurations = this.createConfigurations()
    this.willSaveUntilHandler = new WillSaveUntilHandler(this)
    this.checkBuffer = debounce(() => {
      this._checkBuffer().catch(e => {
        logger.error(e)
      })
    }, 100)
    this.setupDynamicAutocmd = debounce(() => {
      this._setupDynamicAutocmd().catch(e => {
        logger.error(e)
      })
    }, global.hasOwnProperty('__TEST__') ? 0 : 100)
    this.setMessageLevel()
  }

  public async init(): Promise<void> {
    this.statusLine = new StatusLine(this.nvim)
    this._env = await this.nvim.call('coc#util#vim_info') as Env
    this.checkProcess()
    this.configurations.updateUserConfig(this._env.config)
    events.on('BufEnter', this.onBufEnter, this, this.disposables)
    events.on('DirChanged', this.onDirChanged, this, this.disposables)
    events.on('BufCreate', this.onBufCreate, this, this.disposables)
    events.on('BufUnload', this.onBufUnload, this, this.disposables)
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
    let { errorItems } = this.configurations
    this.showErrors(errorItems)
    this.configurations.onError(async errors => {
      this.showErrors(errors)
    }, null, this.disposables)
    this.configurations.onDidChange(e => {
      this._onDidChangeConfiguration.fire(e)
    }, null, this.disposables)

    this.watchOption('iskeyword', (_, newValue: string) => {
      let doc = this.getDocument(this.bufnr)
      if (doc) doc.setIskeyword(newValue)
    }, this.disposables)
    this.watchOption('completeopt', async (_, newValue) => {
      this.env.completeOpt = newValue
      if (!this._attached) return
      let mode = await this.nvim.call('mode') as string
      if (mode.startsWith('i')) console.error(`Some plugin change completeopt on insert mode!`) // tslint:disable-line
    }, this.disposables)
    this.watchGlobal('coc_enabled', async (oldValue, newValue) => {
      if (newValue == oldValue) return
      if (newValue == 1) {
        await this.attach()
      } else {
        await this.detach()
      }
    }, this.disposables)
  }

  public getConfigFile(target: ConfigurationTarget): string {
    return this.configurations.getConfigFile(target)
  }

  public registerAutocmd(autocmd: Autocmd): Disposable {
    let id = this.autocmds.size + 1
    this.autocmds.set(id, autocmd)
    this.setupDynamicAutocmd()
    return Disposable.create(() => {
      this.autocmds.delete(id)
      this.setupDynamicAutocmd()
    })
  }

  public watchOption(key: string, callback?: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void {
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

  /**
   * uri of current file, could be null
   *
   * @public
   * @returns {string}
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

  public async createNameSpace(name = ''): Promise<number> {
    if (this.namespaceMap.has(name)) return this.namespaceMap.get(name)
    if (this.nvim.hasFunction('nvim_create_namespace')) {
      let res = await this.nvim.createNamespace(name)
      if (res) this.namespaceMap.set(name, res)
      return res
    }
    return 0
  }

  public get channelNames(): string[] {
    return Array.from(this.outputChannels.keys())
  }

  public get pluginRoot(): string {
    return isPkg ? path.resolve(process.execPath, '../..') : path.dirname(__dirname)
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

  public get filetypes(): Set<string> {
    let res = new Set() as Set<string>
    for (let doc of this.documents) {
      res.add(doc.filetype)
    }
    return res
  }

  public match(selector: DocumentSelector, document: TextDocument): number {
    return score(selector, document.uri, document.languageId)
  }

  public getVimSetting<K extends keyof Env>(name: K): Env[K] {
    return this._env[name]
  }

  public async findUp(filename: string | string[]): Promise<string | null> {
    let bufnr = await this.nvim.call('bufnr', '%')
    let doc = this.getDocument(bufnr)
    let root: string
    if (doc && doc.schema == 'file') {
      root = path.dirname(Uri.parse(doc.uri).fsPath)
    } else {
      root = this.root
    }
    return await findUp(filename, { cwd: root })
  }

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

  public getConfiguration(section?: string, resource?: string): WorkspaceConfiguration {
    return this.configurations.getConfiguration(section, resource)
  }

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

  public async getOffset(): Promise<number> {
    let document = await this.document
    let pos = await this.getCursorPosition()
    return document.textDocument.offsetAt(pos)
  }

  public async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    let { nvim } = this
    let { documentChanges, changes } = edit
    if (documentChanges) {
      documentChanges = this.mergeDocumentChanges(documentChanges)
      if (!this.validteDocumentChanges(documentChanges)) return false
    }
    let curpos = await nvim.call('getcurpos')
    let filetype = await nvim.buffer.getOption('filetype') as string
    let encoding = await this.getFileEncoding()
    let changedFiles = this.getChangedFiles(edit)
    let len = changedFiles.length
    if (len > 0) {
      let confirm = await this.showPrompt(`${len} files on disk will be changed. Confirm`)
      if (!confirm) return false
    }
    if (changes) {
      for (let uri of Object.keys(changes)) {
        let edits = changes[uri]
        let document = this.getDocument(uri)
        let doc: TextDocument
        if (document) {
          doc = document.textDocument
          await document.applyEdits(nvim, edits)
        } else {
          let filepath = Uri.parse(uri).fsPath
          let stat = await statAsync(filepath)
          if (stat && stat.isFile()) {
            let content = fs.readFileSync(filepath, encoding)
            doc = TextDocument.create(uri, filetype, 0, content)
            let res = TextDocument.applyEdits(doc, edits)
            await writeFile(filepath, res)
          }
        }
      }
    }
    if (documentChanges && documentChanges.length) {
      let n = documentChanges.length
      for (let change of documentChanges) {
        if (TextDocumentEdit.is(change)) {
          let { textDocument, edits } = change
          if (textDocument.version != null) {
            let doc = this.getDocument(textDocument.uri)
            await doc.applyEdits(nvim, edits)
          } else {
            let u = Uri.parse(textDocument.uri)
            let filepath = u.fsPath
            let content = fs.readFileSync(filepath, encoding)
            let doc = TextDocument.create(textDocument.uri, filetype, 0, content)
            let res = TextDocument.applyEdits(doc, edits)
            await writeFile(filepath, res)
          }
        } else if (CreateFile.is(change)) {
          let file = Uri.parse(change.uri).fsPath
          await this.createFile(file, change.options)
        } else if (RenameFile.is(change)) {
          await this.renameFile(Uri.parse(change.oldUri).fsPath, Uri.parse(change.newUri).fsPath, change.options)
        } else if (DeleteFile.is(change)) {
          await this.deleteFile(Uri.parse(change.uri).fsPath, change.options)
        }
      }
      this.showMessage(`${n} documents changed!`)
    }
    if (changedFiles.length) {
      let names = await Promise.all(changedFiles.map(uri => {
        return this.getbufname(uri)
      }))
      await nvim.command(`argadd ${names.join(' ')}`)
    }
    await nvim.call('setpos', ['.', curpos])
    return true
  }

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

  public createMru(name: string): Mru {
    return new Mru(name)
  }

  public async showLocations(locations: Location[]): Promise<void> {
    let items = await Promise.all(locations.map(loc => {
      return this.getQuickfixItem(loc)
    }))
    let { nvim } = this
    await nvim.setVar('coc_jump_locations', items)
    await nvim.command('doautocmd User CocLocationsChange')
  }

  public async getLine(uri: string, line: number): Promise<string> {
    let document = this.getDocument(uri)
    if (document) return document.getline(line) || ''
    if (!uri.startsWith('file:')) return ''
    return await readFileLine(Uri.parse(uri).fsPath, line)
  }

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

  public async echoLines(lines: string[], truncate = false): Promise<void> {
    let { nvim } = this
    let cmdHeight = await nvim.getOption('cmdheight') as number
    if (lines.length > cmdHeight && truncate) {
      lines = lines.slice(0, cmdHeight)
      let last = lines[cmdHeight - 1]
      lines[cmdHeight - 1] = `${last} ...`
    }
    let columns = await nvim.getOption('columns')
    lines = lines.map(line => {
      line = line.replace(/\n/g, ' ')
      if (truncate) line = line.slice(0, (columns as number) - 1)
      return line
    })
    nvim.callTimer('coc#util#echo_lines', [lines], true)
  }

  public showMessage(msg: string, identify: MsgTypes = 'more'): void {
    if (this._blocking) return
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

  public get document(): Promise<Document> {
    let { bufnr } = this
    if (bufnr == null) return null
    if (this.buffers.has(bufnr)) {
      return Promise.resolve(this.buffers.get(bufnr))
    }
    return this.nvim.buffer.then(buffer => {
      let { id } = buffer
      let doc = this.buffers.get(id)
      if (doc) return doc
      if (!this.creating.has(id)) {
        return this.onBufCreate(id).then(() => {
          return this.getDocument(id)
        })
      }
      return new Promise<Document>(resolve => {
        let disposable = this.onDidOpenTextDocument(doc => {
          disposable.dispose()
          resolve(this.getDocument(doc.uri))
        })
      })
    })
  }

  public async getCursorPosition(): Promise<Position> {
    let [, lnum, col] = await this.nvim.call('getpos', ['.'])
    let line = await this.nvim.call('getline', '.')
    return Position.create(lnum - 1, byteIndex(line, col - 1))
  }

  public async getCurrentState(): Promise<EditerState> {
    let document = await this.document
    let position = await this.getCursorPosition()
    return {
      document: document.textDocument,
      position
    }
  }

  public async getFormatOptions(uri?: string): Promise<FormattingOptions> {
    let doc: Document
    if (uri) {
      doc = this.getDocument(uri)
    } else {
      doc = await this.document
    }
    let tabSize = await this.getDocumentOption('shiftwidth', doc) as number
    if (!tabSize) tabSize = await this.getDocumentOption('tabstop', doc) as number
    let insertSpaces = (await this.getDocumentOption('expandtab', doc)) == 1
    return {
      tabSize,
      insertSpaces
    } as FormattingOptions
  }

  private getDocumentOption(name: string, doc?: Document): Promise<VimValue> {
    return doc ? doc.buffer.getOption(name) : this.nvim.getOption(name)
  }

  public async jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void> {
    const preferences = this.getConfiguration('coc.preferences')
    let jumpCommand = openCommand || preferences.get<string>('jumpCommand', 'edit')
    let { nvim } = this
    let { line, character } = position || { line: 0, character: 0 }
    let doc = this.getDocument(uri)
    let col = character + 1
    if (doc) col = byteLength(doc.getline(line).slice(0, character)) + 1
    let u = Uri.parse(uri)
    let bufname = u.scheme == 'file' ? u.fsPath : u.toString()
    await nvim.command(`normal! m'`)
    let loaded = await nvim.call('bufloaded', bufname)
    let bufnr = loaded == 0 ? -1 : await nvim.call('bufnr', bufname)
    if (bufnr == this.bufnr && position && jumpCommand == 'edit') {
      await nvim.call('cursor', [line + 1, col])
    } else if (bufnr != -1 && jumpCommand == 'edit') {
      let moveCmd = position ? `+call\\ cursor(${line + 1},${col})` : ''
      await nvim.callTimer('coc#util#execute', [`buffer ${moveCmd} ${bufnr}`])
    } else {
      let cwd = await nvim.call('getcwd')
      let file = bufname.startsWith(cwd) ? path.relative(cwd, bufname) : bufname
      file = await nvim.call('fnameescape', file)
      let moveCmd = position ? `+call\\ cursor(${line + 1},${col})` : ''
      await nvim.callTimer('coc#util#execute', [`${jumpCommand} ${moveCmd} ${file}`])
    }
    if (this.isVim) await wait(100)
  }

  public async moveTo(position: Position): Promise<void> {
    let { nvim } = this
    let line = await nvim.call('getline', position.line + 1)
    let col = byteLength(line.slice(0, position.character)) + 1
    await nvim.call('cursor', [position.line + 1, col])
  }

  public async createFile(filepath: string, opts: CreateFileOptions = {}): Promise<void> {
    let stat = await statAsync(filepath)
    if (stat && !opts.overwrite && !opts.ignoreIfExists) {
      this.showMessage(`${filepath} already exists!`, 'error')
      return
    }
    if (!stat || opts.overwrite) {
      if (filepath.endsWith('/')) {
        try {
          await mkdirAsync(filepath)
        } catch (e) {
          this.showMessage(`Can't create ${filepath}: ${e.message}`, 'error')
        }
      } else {
        let uri = Uri.file(filepath).toString()
        let doc = this.getDocument(uri)
        if (doc) return
        let encoding = await this.getFileEncoding()
        fs.writeFileSync(filepath, '', encoding || '')
        if (!doc) {
          let bufname = filepath.startsWith(this.cwd) ? path.relative(this.cwd, filepath) : filepath
          await this.nvim.command(`argadd ${bufname}`)
        }
      }
    }
  }

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
          await this.onBufCreate(doc.bufnr)
        }
      } catch (e) {
        // console.error(e)
        this.showMessage(`Rename error ${e.message}`, 'error')
      }
    }
  }

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
      await pify(fs[method])(filepath)
      if (!isDir) {
        let uri = Uri.file(filepath).toString()
        let doc = this.getDocument(uri)
        if (doc) {
          await this.nvim.command(`bdelete ${doc.bufnr}`)
        }
      }
    } catch (e) {
      this.showMessage(`Error on delete ${filepath}: ${e.message}`, 'error')
    }
  }

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

  public createOutputChannel(name: string): OutputChannel {
    if (this.outputChannels.has(name)) return this.outputChannels.get(name)
    let channel = new BufferChannel(name, this.nvim)
    this.outputChannels.set(name, channel)
    return channel
  }

  public showOutputChannel(name: string): void {
    let channel = this.outputChannels.get(name)
    if (!channel) {
      this.showMessage(`Channel "${name}" not found`, 'error')
      return
    }
    channel.show(false)
  }

  public async resolveModule(name: string): Promise<string> {
    return await this.resolver.resolveModule(name)
  }

  public async runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string> {
    cwd = cwd || this.cwd
    return runCommand(cmd, cwd, timeout)
  }

  public async runTerminalCommand(cmd: string, cwd = this.cwd, keepfocus = false): Promise<TerminalResult> {
    return await this.nvim.callAsync('coc#util#run_terminal', { cmd, cwd, keepfocus: keepfocus ? 1 : 0 }) as TerminalResult
  }

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

  public async showPrompt(title: string): Promise<boolean> {
    this._blocking = true
    let res = await this.nvim.call('coc#util#prompt_confirm', title)
    this._blocking = false
    return res == 1
  }

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

  public createStatusBarItem(priority = 0, opt: StatusItemOption = {}): StatusBarItem {
    if (!this.statusLine) return null
    return this.statusLine.createStatusBarItem(priority, opt.progress || false)
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
    buf.setOption('readonly', true)
    await buf.setLines(content.split('\n'), {
      start: 0,
      end: -1,
      strictIndexing: false
    })
    setTimeout(async () => {
      await events.fire('BufCreate', [buf.id])
    }, 30)
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
    this.checkBuffer.clear()
    this.setupDynamicAutocmd.clear()
    this.buffers.clear()
    if (this.statusLine) this.statusLine.dispose()
  }

  private async attach(): Promise<void> {
    if (this._attached) return
    this._attached = true
    let bufnr = this.bufnr = await this.nvim.call('bufnr', '%')
    let buffers = await this.nvim.buffers
    await Promise.all(buffers.map(buf => {
      return this.onBufCreate(buf, true)
    }))
    if (!this._initialized) {
      this._onDidWorkspaceInitialized.fire(void 0)
      this._initialized = true
    }
    await events.fire('BufEnter', [bufnr])
    let winid = await this.nvim.call('win_getid')
    await events.fire('BufWinEnter', [bufnr, winid])
  }

  public async detach(): Promise<void> {
    if (!this._attached) return
    this._attached = false
    for (let bufnr of this.buffers.keys()) {
      await events.fire('BufUnload', [bufnr])
    }
  }

  private getChangedFiles(edit: WorkspaceEdit): string[] {
    let { documentChanges, changes } = edit
    let res: string[] = []
    if (changes) {
      for (let uri of Object.keys(changes)) {
        if (uri.startsWith('file')
          && fs.existsSync(Uri.parse(uri).fsPath)
          && !this.getDocument(uri)) {
          res.push(uri)
        }
      }
    }
    if (documentChanges) {
      for (let change of documentChanges) {
        if (TextDocumentEdit.is(change)) {
          let { textDocument } = change
          if (textDocument.version == null) {
            res.push(textDocument.uri)
          }
        }
      }
    }
    return res
  }

  private validteDocumentChanges(documentChanges: any[] | null): boolean {
    if (!documentChanges) return true
    for (let change of documentChanges) {
      if (TextDocumentEdit.is(change)) {
        let { textDocument } = change
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
    const onChange = async bufnr => {
      let doc = this.getDocument(bufnr)
      if (doc) doc.fetchContent()
    }
    events.on('TextChangedI', onChange, null, this.disposables)
    events.on('TextChanged', onChange, null, this.disposables)
  }

  private async onBufCreate(buf: number | Buffer, initialize = false): Promise<void> {
    this.checkBuffer.clear()
    let buffer = typeof buf === 'number' ? this.nvim.createBuffer(buf) : buf
    if (this.creating.has(buffer.id)) return
    this.creating.add(buffer.id)
    let loaded = await this.nvim.call('bufloaded', buffer.id)
    if (!loaded) {
      this.creating.delete(buffer.id)
      return
    }
    let bufnr = buffer.id
    let document = this.getDocument(bufnr)
    try {
      if (document) await events.fire('BufUnload', [bufnr])
      document = new Document(buffer,
        this.configurations.getConfiguration('coc.preferences'),
        this._env)
      let created = await document.init(this.nvim)
      if (!created) {
        this.creating.delete(bufnr)
        return
      }
    } catch (e) {
      this.creating.delete(bufnr)
      logger.error(e)
      return
    }
    if (!initialize) this.bufnr = await this.nvim.call('bufnr', '%')
    this.creating.delete(bufnr)
    this.buffers.set(bufnr, document)
    if (bufnr == this.bufnr
      && document.buftype == ''
      && document.schema == 'file') {
      let root = await this.resolveRoot(document.uri)
      if (root && this.bufnr == buffer.id && this._root !== root) {
        let { configurations } = this
        if (!configurations.hasFolderConfiguration(root)) {
          let folder = await findUp('.vim', { cwd: root })
          if (folder && folder != os.homedir()) {
            let file = path.join(folder, CONFIG_FILE_NAME)
            let stat = await statAsync(file)
            if (stat && stat.isFile()) {
              this.configurations.addFolderFile(file)
            }
          }
        } else {
          configurations.setFolderConfiguration(document.uri)
        }
        this._root = root
        this._onDidChangeWorkspaceFolder.fire(this.workspaceFolder)
      }
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
    if (doc) this.configurations.setFolderConfiguration(doc.uri)
  }

  private async onBufWritePost(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    this._onDidSaveDocument.fire(doc.textDocument)
  }

  private async onBufUnload(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (doc) {
      this._onDidCloseDocument.fire(doc.textDocument)
      doc.detach()
      this.buffers.delete(bufnr)
    }
    logger.debug('buffer unload', bufnr)
  }

  private async onBufWritePre(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    await doc.checkDocument()
    let event: TextDocumentWillSaveEvent = {
      document: doc.textDocument,
      reason: TextDocumentSaveReason.Manual
    }
    this._onWillSaveDocument.fire(event)
    await this.willSaveUntilHandler.handeWillSaveUntil(event)
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

  private async _checkBuffer(): Promise<void> {
    await wait(30)
    if (this._disposed) return
    let bufnr = await this.nvim.call('bufnr', '%')
    // it's possible that vim exiting
    if (!bufnr) return
    this.bufnr = bufnr
    let doc = this.getDocument(bufnr)
    if (!doc) await this.onBufCreate(bufnr)
  }

  private async getFileEncoding(): Promise<string> {
    let encoding = await this.nvim.getOption('fileencoding') as string
    return encoding ? encoding : 'utf-8'
  }

  private showErrors(errors: ErrorItem[]): void {
    if (!errors.length) return
    let items: QuickfixItem[] = []
    for (let err of errors) {
      items.push({
        uri: err.location.uri,
        range: err.location.range,
        text: err.message,
        type: 'Error'
      })
    }
    setTimeout(async () => {
      let { nvim } = this
      await nvim.setVar('coc_jump_locations', items)
      await nvim.command('doautocmd User CocLocationsChange')
    }, 10)
  }

  private async resolveRoot(uri: string): Promise<string> {
    let u = Uri.parse(uri)
    let dir = path.dirname(u.fsPath)
    if (dir != os.homedir()) {
      const preferences = this.getConfiguration('coc.preferences')
      let roots = preferences.get<string[]>('rootPatterns')
      roots = roots || ['.vim', '.git', '.hg', '.projections.json']
      roots = roots.map(s => s.endsWith('/') ? s.slice(0, -1) : s)
      return resolveRoot(dir, roots)
    }
  }

  private async getbufname(filepath: string): Promise<string> {
    let { cwd } = this
    let bufname = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
    return await this.nvim.call('fnameescape', bufname)
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
      if (TextDocumentEdit.is(change)) {
        let { edits, textDocument } = change
        let documentEdit = documentEdits.find(o => o.textDocument.uri == textDocument.uri && o.textDocument.version === textDocument.version)
        if (documentEdit) {
          documentEdit.edits.push(...edits)
        } else {
          documentEdits.push(change)
        }
      } else {
        res.push(change)
      }
    }
    res.push(...documentEdits)
    return res
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
}

export default new Workspace()
