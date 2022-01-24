import { NeovimClient as Neovim } from '@chemzqm/neovim'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Disposable, DocumentSelector, Emitter, Event, FormattingOptions, Location, LocationLink, Position, Range, RenameFile, RenameFileOptions, TextDocumentEdit, WorkspaceEdit, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import which from 'which'
import { version as VERSION } from '../package.json'
import Configurations from './configuration'
import ConfigurationShape from './configuration/shape'
import Autocmds from './core/autocmds'
import channels from './core/channels'
import ContentProvider from './core/contentProvider'
import Documents from './core/documents'
import FileSystemWatcher from './core/fileSystemWatcher'
import has from './core/has'
import Keymaps from './core/keymaps'
import Locations from './core/locations'
import Watchers from './core/watchers'
import WorkspaceFolderController from './core/workspaceFolder'
import events from './events'
import BufferSync, { SyncItem } from './model/bufferSync'
import DB from './model/db'
import Document from './model/document'
import Mru from './model/mru'
import Resolver from './model/resolver'
import Task from './model/task'
import TerminalModel, { TerminalOptions } from './model/terminal'
import { LinesTextDocument } from './model/textdocument'
import { TextDocumentContentProvider } from './provider'
import { Autocmd, ConfigurationChangeEvent, ConfigurationTarget, DidChangeTextDocumentParams, DocumentChange, EditerState, Env, FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent, IWorkspace, KeymapOption, OutputChannel, QuickfixItem, TextDocumentWillSaveEvent, WorkspaceConfiguration } from './types'
import { findUp, isFile, isParentFolder, renameAsync, statAsync } from './util/fs'
import { CONFIG_FILE_NAME, disposeAll, MapMode, runCommand, wait } from './util/index'
import { score } from './util/match'
import { getChangedFromEdits } from './util/position'
import { byteLength } from './util/string'
import window from './window'

const APIVERSION = 16
const logger = require('./util/logger')('workspace')
let NAME_SPACE = 2000
const methods = [
  'showMessage', 'runTerminalCommand', 'openTerminal', 'showQuickpick',
  'menuPick', 'openLocalConfig', 'showPrompt', 'createStatusBarItem', 'createOutputChannel',
  'showOutputChannel', 'requestInput', 'echoLines', 'getCursorPosition', 'moveTo',
  'getOffset'
]

export class Workspace implements IWorkspace {
  public readonly nvim: Neovim
  public readonly version: string
  private _env: Env
  private namespaceMap: Map<string, number> = new Map()
  private disposables: Disposable[] = []

  private resolver: Resolver = new Resolver()
  public readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>
  public readonly onDidOpenTextDocument: Event<LinesTextDocument & { bufnr: number }>
  public readonly onDidCloseTextDocument: Event<LinesTextDocument & { bufnr: number }>
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams>
  public readonly onDidSaveTextDocument: Event<LinesTextDocument>
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>
  public readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>
  public readonly onDidCloseTerminal: Event<TerminalModel>
  public readonly onDidOpenTerminal: Event<TerminalModel>
  public readonly configurations: Configurations
  public readonly workspaceFolderControl: WorkspaceFolderController
  public readonly documentsManager: Documents
  public readonly contentProvider: ContentProvider
  public readonly autocmds: Autocmds
  public readonly watchers: Watchers
  public readonly keymaps: Keymaps
  public readonly locations: Locations

  private _onDidCreateFiles = new Emitter<FileCreateEvent>()
  private _onDidRenameFiles = new Emitter<FileRenameEvent>()
  private _onDidDeleteFiles = new Emitter<FileDeleteEvent>()
  private _onWillCreateFiles = new Emitter<FileWillCreateEvent>()
  private _onWillRenameFiles = new Emitter<FileWillRenameEvent>()
  private _onWillDeleteFiles = new Emitter<FileWillDeleteEvent>()

  public readonly onDidRuntimePathChange: Event<string[]>
  public readonly onDidCreateFiles: Event<FileCreateEvent> = this._onDidCreateFiles.event
  public readonly onDidRenameFiles: Event<FileRenameEvent> = this._onDidRenameFiles.event
  public readonly onDidDeleteFiles: Event<FileDeleteEvent> = this._onDidDeleteFiles.event
  public readonly onWillCreateFiles: Event<FileWillCreateEvent> = this._onWillCreateFiles.event
  public readonly onWillRenameFiles: Event<FileWillRenameEvent> = this._onWillRenameFiles.event
  public readonly onWillDeleteFiles: Event<FileWillDeleteEvent> = this._onWillDeleteFiles.event

  constructor() {
    this.version = VERSION
    let home = path.normalize(process.env.COC_VIMCONFIG) || path.join(os.homedir(), '.vim')
    let userConfigFile = path.join(home, CONFIG_FILE_NAME)
    this.configurations = new Configurations(userConfigFile, new ConfigurationShape(this))
    this.workspaceFolderControl = new WorkspaceFolderController(this.configurations)
    this.onDidChangeWorkspaceFolders = this.workspaceFolderControl.onDidChangeWorkspaceFolders
    this.onDidChangeConfiguration = this.configurations.onDidChange
    let documents = this.documentsManager = new Documents(this.configurations, this.workspaceFolderControl)
    this.onDidOpenTextDocument = documents.onDidOpenTextDocument
    this.onDidChangeTextDocument = documents.onDidChangeDocument
    this.onDidCloseTextDocument = documents.onDidCloseDocument
    this.onDidSaveTextDocument = documents.onDidSaveTextDocument
    this.onWillSaveTextDocument = documents.onWillSaveTextDocument
    this.onDidOpenTerminal = documents.onDidOpenTerminal
    this.onDidCloseTerminal = documents.onDidCloseTerminal
    this.contentProvider = new ContentProvider(documents)
    this.watchers = new Watchers()
    this.autocmds = new Autocmds(this.contentProvider, this.watchers)
    this.keymaps = new Keymaps(documents)
    this.locations = new Locations(this.configurations, documents)
    this.onDidRuntimePathChange = this.watchers.onDidRuntimePathChange
  }

  public async init(): Promise<void> {
    let { nvim } = this
    for (let method of methods) {
      Object.defineProperty(this, method, {
        get: () => {
          return (...args: any[]) => {
            let stack = '\n' + Error().stack.split('\n').slice(2, 4).join('\n')
            logger.warn(`workspace.${method} is deprecated, please use window.${method} instead.`, stack)
            return window[method].apply(window, args)
          }
        }
      })
    }
    let env = this._env = await nvim.call('coc#util#vim_info') as Env
    if (this._env.apiversion != APIVERSION) {
      console.error(`API version ${this._env.apiversion} is not ${APIVERSION}, please build coc.nvim by 'yarn install' after pull source code.`)
      process.exit()
    }
    this.workspaceFolderControl.setWorkspaceFolders(this._env.workspaceFolders)
    this.configurations.updateUserConfig(this._env.config)
    events.on('VimResized', (columns, lines) => {
      Object.assign(this._env, { columns, lines })
    }, null, this.disposables)

    await this.attach()
    this.contentProvider.attach(nvim)
    this.keymaps.attach(nvim)
    this.autocmds.attach(nvim, env)
    this.locations.attach(nvim, env)
    this.watchers.attach(nvim, env)
    this.disposables.push(this.registerTextDocumentContentProvider('output', channels.getProvider(nvim)))
  }

  public getConfigFile(target: ConfigurationTarget): string {
    return this.configurations.getConfigFile(target)
  }

  /**
   * Like vim's has(), but for version check only.
   * Check patch on neovim and check nvim on vim would return false.
   *
   * For example:
   * - has('nvim-0.6.0')
   * - has('patch-7.4.248')
   */
  public has(feature: string): boolean {
    return has(this.env, feature)
  }

  public get cwd(): string {
    return this.documentsManager.cwd
  }

  public get env(): Env {
    return this._env
  }

  public get root(): string {
    return this.documentsManager.root || this.cwd
  }

  public get rootPath(): string {
    return this.root
  }

  public get bufnr(): number {
    return this.documentsManager.bufnr
  }

  public get insertMode(): boolean {
    return events.insertMode
  }

  public get floatSupported(): boolean {
    return this.env.floating || this.env.textprop
  }

  public get uri(): string {
    return this.documentsManager.uri
  }

  public get textDocuments(): TextDocument[] {
    return this.documentsManager.textDocuments
  }

  public get documents(): Document[] {
    return this.documentsManager.documents
  }

  public get document(): Promise<Document | undefined> {
    return this.documentsManager.document
  }

  /**
   * @deprecated
   */
  public get workspaceFolder(): WorkspaceFolder {
    return this.workspaceFolders[0]
  }

  public get workspaceFolders(): WorkspaceFolder[] {
    return this.workspaceFolderControl.workspaceFolders
  }

  public get folderPaths(): string[] {
    return this.workspaceFolders.map(f => URI.parse(f.uri).fsPath)
  }

  public createNameSpace(name = ''): number {
    if (this.namespaceMap.has(name)) return this.namespaceMap.get(name)
    NAME_SPACE = NAME_SPACE + 1
    this.namespaceMap.set(name, NAME_SPACE)
    return NAME_SPACE
  }

  public get channelNames(): string[] {
    return channels.names
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

  public get filetypes(): Set<string> {
    return this.documentsManager.filetypes
  }

  public get languageIds(): Set<string> {
    return this.documentsManager.languageIds
  }

  /**
   * Register autocmd on vim.
   */
  public registerAutocmd(autocmd: Autocmd): Disposable {
    return this.autocmds.registerAutocmd(autocmd)
  }

  /**
   * Watch for option change.
   */
  public watchOption(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void {
    this.watchers.watchOption(key, callback, disposables)
  }

  /**
   * Watch global variable, works on neovim only.
   */
  public watchGlobal(key: string, callback?: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void {
    this.watchers.watchGlobal(key, callback, disposables)
  }

  /**
   * Check if selector match document.
   */
  public match(selector: DocumentSelector, document: TextDocument): number {
    return score(selector, document.uri, document.languageId)
  }

  /**
   * Create a FileSystemWatcher instance,
   * doesn't fail when watchman not found.
   */
  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher {
    let watchmanPath = global.hasOwnProperty('__TEST__') ? null : this.getWatchmanPath()
    let channel: OutputChannel = watchmanPath ? window.createOutputChannel('watchman') : null
    let watcher = new FileSystemWatcher(
      this.workspaceFolderControl,
      watchmanPath,
      channel,
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
  public getDocument(uri: number | string): Document | null {
    return this.documentsManager.getDocument(uri)
  }

  /**
   * Convert location to quickfix item.
   */
  public getQuickfixItem(loc: Location | LocationLink, text?: string, type = '', module?: string): Promise<QuickfixItem> {
    return this.locations.getQuickfixItem(loc, text, type, module)
  }

  /**
   * Create persistence Mru instance.
   */
  public createMru(name: string): Mru {
    return new Mru(name)
  }

  public async getQuickfixList(locations: Location[]): Promise<ReadonlyArray<QuickfixItem>> {
    return this.locations.getQuickfixList(locations)
  }

  /**
   * Populate locations to UI.
   */
  public async showLocations(locations: Location[]): Promise<void> {
    await this.locations.showLocations(locations)
  }

  /**
   * Get content of line by uri and line.
   */
  public getLine(uri: string, line: number): Promise<string> {
    return this.locations.getLine(uri, line)
  }

  /**
   * Get WorkspaceFolder of uri
   */
  public getWorkspaceFolder(uri: string): WorkspaceFolder | null {
    return this.workspaceFolderControl.getWorkspaceFolder(URI.parse(uri))
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

  public async getCurrentState(): Promise<EditerState> {
    let document = await this.document
    let position = await window.getCursorPosition()
    return {
      document: document.textDocument,
      position
    }
  }

  public async getFormatOptions(uri?: string): Promise<FormattingOptions> {
    return this.documentsManager.getFormatOptions(uri)
  }

  /**
   * Resolve module from yarn or npm.
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
   * Expand filepath with `~` and/or environment placeholders
   */
  public expand(filepath: string): string {
    return this.documentsManager.expand(filepath)
  }

  public async createTerminal(opts: TerminalOptions): Promise<TerminalModel> {
    return await this.documentsManager.createTerminal(opts)
  }

  public async callAsync<T>(method: string, args: any[]): Promise<T> {
    if (this.isNvim) return await this.nvim.call(method, args)
    return await this.nvim.callAsync('coc#util#with_callback', [method, args])
  }

  /**
   * registerTextDocumentContentProvider
   */
  public registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable {
    return this.contentProvider.registerTextDocumentContentProvider(scheme, provider)
  }

  /**
   * Register unique keymap uses `<Plug>(coc-{key})` as lhs
   * Throw error when {key} already exists.
   *
   * @param {MapMode[]} modes - array of 'n' | 'i' | 'v' | 'x' | 's' | 'o'
   * @param {string} key - unique name
   * @param {Function} fn - callback function
   * @param {Partial} opts
   * @returns {Disposable}
   */
  public registerKeymap(modes: MapMode[], key: string, fn: Function, opts: Partial<KeymapOption> = {}): Disposable {
    return this.keymaps.registerKeymap(modes, key, fn, opts)
  }

  /**
   * Register expr keymap.
   */
  public registerExprKeymap(mode: 'i' | 'n' | 'v' | 's' | 'x', key: string, fn: Function, buffer = false): Disposable {
    return this.keymaps.registerExprKeymap(mode, key, fn, buffer)
  }

  public registerLocalKeymap(mode: 'n' | 'v' | 's' | 'x', key: string, fn: Function, notify = false): Disposable {
    return this.keymaps.registerLocalKeymap(mode, key, fn, notify)
  }

  /**
   * Create Task instance that runs in vim.
   */
  public createTask(id: string): Task {
    return new Task(this.nvim, id)
  }

  public registerBufferSync<T extends SyncItem>(create: (doc: Document) => T | undefined): BufferSync<T> {
    return new BufferSync(create, this)
  }

  public async attach(): Promise<void> {
    await this.documentsManager.attach(this.nvim, this._env)
  }

  public jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void> {
    return this.locations.jumpTo(uri, position, openCommand)
  }

  /**
   * Findup for filename or filenames from current filepath or root.
   */
  public async findUp(filename: string | string[]): Promise<string | null> {
    let { cwd } = this
    let filepath = await this.nvim.call('expand', '%:p') as string
    filepath = path.normalize(filepath)
    let isFile = filepath && path.isAbsolute(filepath)
    if (isFile && !isParentFolder(cwd, filepath, true)) {
      // can't use cwd
      return findUp(filename, path.dirname(filepath))
    }
    let res = findUp(filename, cwd)
    if (res && res != os.homedir()) return res
    if (isFile) return findUp(filename, path.dirname(filepath))
    return null
  }

  /**
   * Apply WorkspaceEdit.
   */
  public async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    let { nvim } = this
    let { documentChanges, changes } = edit
    let [bufnr, cursor] = await nvim.eval('[bufnr("%"),coc#cursor#position()]') as [number, [number, number]]
    let document = this.getDocument(bufnr)
    let uri = document ? document.uri : null
    let currEdits = null
    let locations: Location[] = []
    let changeCount = 0
    const preferences = this.getConfiguration('coc.preferences')
    let promptUser = !global.hasOwnProperty('__TEST__') && preferences.get<boolean>('promptWorkspaceEdit', true)
    let listTarget = preferences.get<string>('listOfWorkspaceEdit', 'quickfix')
    try {
      if (documentChanges && documentChanges.length) {
        let changedUris = this.getChangedUris(documentChanges)
        changeCount = changedUris.length
        if (promptUser) {
          let diskCount = changedUris.reduce((p, c) => {
            return p + (this.getDocument(c) == null ? 1 : 0)
          }, 0)
          if (diskCount) {
            let res = await window.showPrompt(`${diskCount} documents on disk would be loaded for change, confirm?`)
            if (!res) return
          }
        }
        let changedMap: Map<string, string> = new Map()
        for (const change of documentChanges) {
          if (TextDocumentEdit.is(change)) {
            let { textDocument, edits } = change
            let doc = await this.loadFile(textDocument.uri)
            if (textDocument.uri == uri) currEdits = edits
            await doc.applyEdits(edits)
            for (let edit of edits) {
              locations.push({ uri: doc.uri, range: edit.range })
            }
          } else if (CreateFile.is(change)) {
            let file = URI.parse(change.uri).fsPath
            await this.createFile(file, change.options)
          } else if (RenameFile.is(change)) {
            changedMap.set(change.oldUri, change.newUri)
            await this.renameFile(URI.parse(change.oldUri).fsPath, URI.parse(change.newUri).fsPath, change.options)
          } else if (DeleteFile.is(change)) {
            await this.deleteFile(URI.parse(change.uri).fsPath, change.options)
          }
        }
        // fix location uris on renameFile
        if (changedMap.size) {
          locations.forEach(location => {
            let newUri = changedMap.get(location.uri)
            if (newUri) location.uri = newUri
          })
        }
      } else if (changes) {
        let uris = Object.keys(changes)
        let unloaded = uris.filter(uri => this.getDocument(uri) == null)
        if (unloaded.length) {
          if (promptUser) {
            let res = await window.showPrompt(`${unloaded.length} documents on disk would be loaded for change, confirm?`)
            if (!res) return
          }
          await this.loadFiles(unloaded)
        }
        for (let uri of Object.keys(changes)) {
          let document = this.getDocument(uri)
          if (URI.parse(uri).toString() == uri) currEdits = changes[uri]
          let edits = changes[uri]
          for (let edit of edits) {
            locations.push({ uri: document.uri, range: edit.range })
          }
          await document.applyEdits(edits)
        }
        changeCount = uris.length
      }
      if (currEdits) {
        let changed = getChangedFromEdits({ line: cursor[0], character: cursor[1] }, currEdits)
        if (changed) await window.moveTo({
          line: cursor[0] + changed.line,
          character: cursor[1] + changed.character
        })
      }
      if (locations.length) {
        let items = await this.getQuickfixList(locations)
        let silent = locations.every(l => l.uri == uri)
        if (listTarget == 'quickfix') {
          await this.nvim.call('setqflist', [items])
          if (!silent) window.showMessage(`changed ${changeCount} buffers, use :wa to save changes to disk and :copen to open quickfix list`, 'more')
        } else if (listTarget == 'location') {
          await nvim.setVar('coc_jump_locations', items)
          if (!silent) window.showMessage(`changed ${changeCount} buffers, use :wa to save changes to disk and :CocList location to manage changed locations`, 'more')
        }
      }
    } catch (e) {
      logger.error('Error on applyEdits:', edit, e)
      window.showMessage(`Error on applyEdits: ${e.message}`, 'error')
      return false
    }
    await wait(50)
    return true
  }

  /**
   * Get selected range for current document
   */
  public async getSelectedRange(mode: string, document: Document): Promise<Range | null> {
    let { nvim } = this
    if (mode === 'line') {
      let line = await nvim.call('line', ['.'])
      let content = document.getline(line - 1)
      if (!content.length) return null
      return Range.create(line - 1, 0, line, 0)
    }
    if (mode === 'cursor') {
      let [line, character] = await nvim.eval("coc#cursor#position()") as [number, number]
      return Range.create(line, character, line, character)
    }
    if (!['v', 'V', 'char', 'line', '\x16'].includes(mode)) {
      throw new Error(`Mode '${mode}' not supported`)
    }
    let isVisual = ['v', 'V', '\x16'].includes(mode)
    let [, sl, sc] = await nvim.call('getpos', isVisual ? `'<` : `'[`) as [number, number, number]
    let [, el, ec] = await nvim.call('getpos', isVisual ? `'>` : `']`) as [number, number, number]
    let range = Range.create(document.getPosition(sl, sc), document.getPosition(el, ec))
    let lastLine = document.getline(el - 1)
    if (mode != 'V' && lastLine.length > range.end.character) {
      range.end.character = range.end.character + 1
    }
    return range
  }

  /**
   * Visual select range of current document
   */
  public async selectRange(range: Range): Promise<void> {
    let { nvim } = this
    let { start, end } = range
    let [bufnr, ve, selection] = await nvim.eval(`[bufnr('%'), &virtualedit, &selection]`) as [number, string, string]
    let doc = this.getDocument(bufnr)
    if (!doc || !doc.attached) return
    let line = doc.getline(start.line)
    let col = line ? byteLength(line.slice(0, start.character)) : 0
    let endLine = doc.getline(end.line)
    let endCol = endLine ? byteLength(endLine.slice(0, end.character)) : 0
    let move_cmd = ''
    let resetVirtualEdit = false
    move_cmd += 'v'
    endCol = await nvim.eval(`virtcol([${end.line + 1}, ${endCol}])`) as number
    if (selection == 'inclusive') {
      if (end.character == 0) {
        move_cmd += `${end.line}G`
      } else {
        move_cmd += `${end.line + 1}G${endCol}|`
      }
    } else if (selection == 'old') {
      move_cmd += `${end.line + 1}G${endCol}|`
    } else {
      move_cmd += `${end.line + 1}G${endCol + 1}|`
    }
    col = await nvim.eval(`virtcol([${start.line + 1}, ${col}])`) as number
    move_cmd += `o${start.line + 1}G${col + 1}|o`
    nvim.pauseNotification()
    if (ve != 'onemore') {
      resetVirtualEdit = true
      nvim.setOption('virtualedit', 'onemore', true)
    }
    nvim.command(`noa call cursor(${start.line + 1},${col + (move_cmd == 'a' ? 0 : 1)})`, true)
    // nvim.call('eval', [`feedkeys("${move_cmd}", 'in')`], true)
    nvim.command(`normal! ${move_cmd}`, true)
    if (resetVirtualEdit) nvim.setOption('virtualedit', ve, true)
    if (this.isVim) nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  /**
   * Create a file in vim and disk
   */
  public async createFile(filepath: string, opts: CreateFileOptions = {}): Promise<void> {
    let stat = await statAsync(filepath)
    if (stat && !opts.overwrite && !opts.ignoreIfExists) {
      window.showMessage(`${filepath} already exists!`, 'error')
      return
    }
    if (!stat || opts.overwrite) {
      // directory
      if (filepath.endsWith('/')) {
        try {
          filepath = this.expand(filepath)
          await fs.mkdirp(filepath)
        } catch (e) {
          window.showMessage(`Can't create ${filepath}: ${e.message}`, 'error')
        }
      } else {
        let uri = URI.file(filepath).toString()
        let doc = this.getDocument(uri)
        if (doc) return
        if (!fs.existsSync(path.dirname(filepath))) {
          fs.mkdirpSync(path.dirname(filepath))
        }
        fs.writeFileSync(filepath, '', 'utf8')
        await this.loadFile(uri)
      }
    }
  }

  /**
   * Load uri as document.
   */
  public async loadFile(uri: string): Promise<Document> {
    let doc = this.getDocument(uri)
    if (doc) return doc
    let { nvim } = this
    let filepath = uri.startsWith('file') ? URI.parse(uri).fsPath : uri
    nvim.call('coc#util#open_files', [[filepath]], true)
    return await new Promise<Document>((resolve, reject) => {
      let disposable = this.onDidOpenTextDocument(textDocument => {
        let fsPath = URI.parse(textDocument.uri).fsPath
        if (textDocument.uri == uri || fsPath == filepath) {
          clearTimeout(timer)
          disposable.dispose()
          resolve(this.getDocument(uri))
        }
      })
      let timer = setTimeout(() => {
        disposable.dispose()
        reject(new Error(`Create document ${uri} timeout after 1s.`))
      }, 1000)
    })
  }

  /**
   * Load the files that not loaded
   */
  public async loadFiles(uris: string[]): Promise<void> {
    uris = uris.filter(uri => this.getDocument(uri) == null)
    if (!uris.length) return
    let bufnrs = await this.nvim.call('coc#util#open_files', [uris.map(u => URI.parse(u).fsPath)]) as number[]
    let create = bufnrs.filter(bufnr => this.getDocument(bufnr) == null)
    if (!create.length) return
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        disposable.dispose()
        reject(new Error(`Create document timeout after 2s.`))
      }, 2000)
      let disposable = this.onDidOpenTextDocument(() => {
        if (uris.every(uri => this.getDocument(uri) != null)) {
          clearTimeout(timer)
          disposable.dispose()
          resolve()
        }
      })
    })
  }

  /**
   * Rename file in vim and disk
   */
  public async renameFile(oldPath: string, newPath: string, opts: RenameFileOptions = {}): Promise<void> {
    let { overwrite, ignoreIfExists } = opts
    let { nvim } = this
    try {
      let stat = await statAsync(newPath)
      if (stat && !overwrite && !ignoreIfExists) {
        throw new Error(`${newPath} already exists`)
      }
      if (!stat || overwrite) {
        let uri = URI.file(oldPath).toString()
        let newUri = URI.file(newPath).toString()
        let doc = this.getDocument(uri)
        if (doc != null) {
          let isCurrent = doc.bufnr == this.bufnr
          let newDoc = this.getDocument(newUri)
          if (newDoc) await this.nvim.command(`silent ${newDoc.bufnr}bwipeout!`)
          let content = doc.getDocumentContent()
          await fs.writeFile(newPath, content, 'utf8')
          // open renamed file
          if (!isCurrent) {
            await nvim.call('coc#util#open_files', [[newPath]])
            await nvim.command(`silent ${doc.bufnr}bwipeout!`)
          } else {
            let view = await nvim.call('winsaveview')
            nvim.pauseNotification()
            nvim.call('coc#util#open_file', ['keepalt edit', newPath], true)
            nvim.command(`silent ${doc.bufnr}bwipeout!`, true)
            nvim.call('winrestview', [view], true)
            await nvim.resumeNotification()
          }
          // avoid vim detect file unlink
          await fs.unlink(oldPath)
        } else {
          await renameAsync(oldPath, newPath)
        }
      }
    } catch (e) {
      window.showMessage(`Rename error: ${e.message}`, 'error')
    }
  }

  /**
   * Delete file from vim and disk.
   */
  public async deleteFile(filepath: string, opts: DeleteFileOptions = {}): Promise<void> {
    let { ignoreIfNotExists, recursive } = opts
    let stat = await statAsync(filepath.replace(/\/$/, ''))
    let isDir = stat && stat.isDirectory()
    if (filepath.endsWith('/') && !isDir) {
      window.showMessage(`${filepath} is not directory`, 'error')
      return
    }
    if (!stat && !ignoreIfNotExists) {
      window.showMessage(`${filepath} not exists`, 'error')
      return
    }
    if (stat == null) return
    if (isDir && !recursive) {
      window.showMessage(`Can't remove directory, recursive not set`, 'error')
      return
    }
    try {
      if (isDir && recursive) {
        await fs.remove(filepath)
      } else if (isDir) {
        await fs.rmdir(filepath)
      } else {
        await fs.unlink(filepath)
      }
      if (!isDir) {
        let uri = URI.file(filepath).toString()
        let doc = this.getDocument(uri)
        if (doc) await this.nvim.command(`silent! bwipeout! ${doc.bufnr}`)
      }
    } catch (e) {
      window.showMessage(`Error on delete ${filepath}: ${e.message}`, 'error')
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
   * Create DB instance at extension root.
   */
  public createDatabase(name: string): DB {
    let root: string
    if (global.hasOwnProperty('__TEST__')) {
      root = path.join(os.tmpdir(), `coc-${process.pid}`)
      fs.mkdirpSync(root)
    } else {
      root = path.dirname(this.env.extensionRoot)
    }
    let filepath = path.join(root, name + '.json')
    return new DB(filepath)
  }

  private getChangedUris(documentChanges: DocumentChange[] | null): string[] {
    let uris: Set<string> = new Set()
    let createUris: Set<string> = new Set()
    for (let change of documentChanges) {
      if (TextDocumentEdit.is(change)) {
        let { textDocument } = change
        let { uri, version } = textDocument
        uris.add(uri)
        if (version != null && version > 0) {
          let doc = this.getDocument(uri)
          if (!doc) {
            throw new Error(`${uri} not loaded`)
          }
          if (doc.version != version) {
            throw new Error(`${uri} changed before apply edit`)
          }
        }
      } else if (CreateFile.is(change) || DeleteFile.is(change)) {
        if (!isFile(change.uri)) {
          throw new Error(`change of scheme ${change.uri} not supported`)
        }
        createUris.add(change.uri)
        uris.add(change.uri)
      } else if (RenameFile.is(change)) {
        if (!isFile(change.oldUri) || !isFile(change.newUri)) {
          throw new Error(`change of scheme ${change.oldUri} not supported`)
        }
        let newFile = URI.parse(change.newUri).fsPath
        if (fs.existsSync(newFile)) {
          throw new Error(`file "${newFile}" already exists for rename`)
        }
        uris.add(change.oldUri)
      } else {
        throw new Error(`Invalid document change: ${JSON.stringify(change, null, 2)}`)
      }
    }
    return Array.from(uris)
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
    let oldPath = URI.parse(doc.uri).fsPath
    // await nvim.callAsync()
    let newPath = await nvim.callAsync('coc#util#with_callback', ['input', ['New path: ', oldPath, 'file']])
    newPath = newPath ? newPath.trim() : null
    if (newPath == oldPath || !newPath) return
    let lines = await doc.buffer.lines
    let exists = fs.existsSync(oldPath)
    if (exists) {
      let modified = await nvim.eval('&modified')
      if (modified) await nvim.command('noa w')
      if (oldPath.toLowerCase() != newPath.toLowerCase() && fs.existsSync(newPath)) {
        let overwrite = await window.showPrompt(`${newPath} exists, overwrite?`)
        if (!overwrite) return
        fs.unlinkSync(newPath)
      }
      fs.renameSync(oldPath, newPath)
    }
    this._onWillRenameFiles.fire({
      files: [{ newUri: URI.parse(newPath), oldUri: URI.parse(oldPath) }],
      waitUntil: async thenable => {
        const edit = await Promise.resolve(thenable)
        if (edit && WorkspaceEdit.is(edit)) {
          await this.applyEdit(edit)
        }
      }
    })
    this._onDidRenameFiles.fire({
      files: [{ newUri: URI.parse(newPath), oldUri: URI.parse(oldPath) }],
    })
    let filepath = isParentFolder(cwd, newPath) ? path.relative(cwd, newPath) : newPath
    let view = await nvim.call('winsaveview')
    nvim.pauseNotification()
    if (oldPath.toLowerCase() == newPath.toLowerCase()) {
      nvim.command(`keepalt ${bufnr}bwipeout!`, true)
      nvim.call('coc#util#open_file', ['keepalt edit', filepath], true)
    } else {
      nvim.call('coc#util#open_file', ['keepalt edit', filepath], true)
      nvim.command(`${bufnr}bwipeout!`, true)
    }
    if (!exists && lines.join('\n') != '\n') {
      nvim.call('append', [0, lines], true)
      nvim.command('normal! Gdd', true)
    }
    nvim.call('winrestview', [view], true)
    await nvim.resumeNotification()
  }

  public async detach(): Promise<void> {
    await this.documentsManager.detach()
  }

  public reset(): void {
    this.workspaceFolderControl.reset()
    this.documentsManager.reset()
  }

  public dispose(): void {
    disposeAll(this.disposables)
    channels.dispose()
    this.watchers.dispose()
    this.autocmds.dispose()
    this.contentProvider.dispose()
    this.documentsManager.dispose()
    this.configurations.dispose()
  }
}

export default new Workspace()
