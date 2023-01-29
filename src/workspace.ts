'use strict'
import { Neovim } from '@chemzqm/neovim'
import type { DocumentSelector, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CreateFileOptions, DeleteFileOptions, FormattingOptions, Location, LocationLink, Position, Range, RenameFileOptions, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Configurations from './configuration'
import ConfigurationShape from './configuration/shape'
import type { ConfigurationResourceScope, WorkspaceConfiguration } from './configuration/types'
import Autocmds from './core/autocmds'
import channels from './core/channels'
import ContentProvider from './core/contentProvider'
import Documents from './core/documents'
import Editors from './core/editors'
import Files, { FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent, TextDocumentWillSaveEvent } from './core/files'
import { FileSystemWatcher, FileSystemWatcherManager } from './core/fileSystemWatcher'
import { callAsync, createNameSpace, findUp, getWatchmanPath, has, resolveModule, score } from './core/funcs'
import Keymaps, { LocalMode, MapMode } from './core/keymaps'
import * as ui from './core/ui'
import Watchers from './core/watchers'
import WorkspaceFolderController from './core/workspaceFolder'
import events from './events'
import { createLogger } from './logger'
import BufferSync, { SyncItem } from './model/bufferSync'
import DB from './model/db'
import type Document from './model/document'
import { FuzzyMatch, FuzzyWasi, initFuzzyWasm } from './model/fuzzyMatch'
import Mru from './model/mru'
import StatusLine from './model/status'
import { StrWidth } from './model/strwidth'
import Task from './model/task'
import { LinesTextDocument } from './model/textdocument'
import { TextDocumentContentProvider } from './provider'
import { Autocmd, DidChangeTextDocumentParams, Env, GlobPattern, IConfigurationChangeEvent, KeymapOption, LocationWithTarget, QuickfixItem, TextDocumentMatch } from './types'
import { APIVERSION, dataHome, pluginRoot, userConfigFile, VERSION, watchmanCommand } from './util/constants'
import { parseExtensionName } from './util/extensionRegistry'
import { IJSONSchema } from './util/jsonSchema'
import { path } from './util/node'
import { toObject } from './util/object'
import { runCommand } from './util/processes'
import { CancellationToken, Disposable, Event } from './util/protocol'
const logger = createLogger('workspace')

const methods = [
  'showMessage', 'runTerminalCommand', 'openTerminal', 'showQuickpick',
  'menuPick', 'openLocalConfig', 'showPrompt', 'createStatusBarItem', 'createOutputChannel',
  'showOutputChannel', 'requestInput', 'echoLines', 'getCursorPosition', 'moveTo',
  'getOffset', 'getSelectedRange', 'selectRange', 'createTerminal',
]

export class Workspace {
  public readonly onDidChangeConfiguration: Event<IConfigurationChangeEvent>
  public readonly onDidOpenTextDocument: Event<LinesTextDocument>
  public readonly onDidCloseTextDocument: Event<LinesTextDocument>
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams>
  public readonly onDidSaveTextDocument: Event<LinesTextDocument>
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>
  public readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>
  public readonly onDidRuntimePathChange: Event<string[]>
  public readonly onDidCreateFiles: Event<FileCreateEvent>
  public readonly onDidRenameFiles: Event<FileRenameEvent>
  public readonly onDidDeleteFiles: Event<FileDeleteEvent>
  public readonly onWillCreateFiles: Event<FileWillCreateEvent>
  public readonly onWillRenameFiles: Event<FileWillRenameEvent>
  public readonly onWillDeleteFiles: Event<FileWillDeleteEvent>
  public readonly nvim: Neovim
  public readonly configurations: Configurations
  public readonly workspaceFolderControl: WorkspaceFolderController
  public readonly documentsManager: Documents
  public readonly contentProvider: ContentProvider
  public readonly autocmds: Autocmds
  public readonly watchers: Watchers
  public readonly keymaps: Keymaps
  public readonly files: Files
  public readonly fileSystemWatchers: FileSystemWatcherManager
  public readonly editors: Editors
  public statusLine = new StatusLine()
  private fuzzyExports: FuzzyWasi
  private strWdith: StrWidth
  private _env: Env

  constructor() {
    void initFuzzyWasm().then(api => {
      this.fuzzyExports = api
    })
    void StrWidth.create().then(strWdith => {
      this.strWdith = strWdith
    })
    events.on('VimResized', (columns, lines) => {
      Object.assign(toObject(this.env), { columns, lines })
    })
    Object.defineProperty(this.statusLine, 'nvim', {
      get: () => this.nvim
    })
    let configurations = this.configurations = new Configurations(userConfigFile, new ConfigurationShape(this))
    this.workspaceFolderControl = new WorkspaceFolderController(this.configurations)
    let documents = this.documentsManager = new Documents(this.configurations, this.workspaceFolderControl)
    this.contentProvider = new ContentProvider(documents)
    this.watchers = new Watchers()
    this.autocmds = new Autocmds()
    this.keymaps = new Keymaps()
    this.files = new Files(documents, this.configurations, this.workspaceFolderControl, this.keymaps)
    this.editors = new Editors(documents)
    this.onDidRuntimePathChange = this.watchers.onDidRuntimePathChange
    this.onDidChangeWorkspaceFolders = this.workspaceFolderControl.onDidChangeWorkspaceFolders
    this.onDidChangeConfiguration = this.configurations.onDidChange
    this.onDidOpenTextDocument = documents.onDidOpenTextDocument
    this.onDidChangeTextDocument = documents.onDidChangeDocument
    this.onDidCloseTextDocument = documents.onDidCloseDocument
    this.onDidSaveTextDocument = documents.onDidSaveTextDocument
    this.onWillSaveTextDocument = documents.onWillSaveTextDocument
    this.onDidCreateFiles = this.files.onDidCreateFiles
    this.onDidRenameFiles = this.files.onDidRenameFiles
    this.onDidDeleteFiles = this.files.onDidDeleteFiles
    this.onWillCreateFiles = this.files.onWillCreateFiles
    this.onWillRenameFiles = this.files.onWillRenameFiles
    this.onWillDeleteFiles = this.files.onWillDeleteFiles
    const preferences = configurations.initialConfiguration.get('coc.preferences') as any
    const watchmanPath = preferences.watchmanPath ?? watchmanCommand
    this.fileSystemWatchers = new FileSystemWatcherManager(this.workspaceFolderControl, watchmanPath)
  }

  public get initialConfiguration(): WorkspaceConfiguration {
    return this.configurations.initialConfiguration
  }

  public async init(window: any): Promise<void> {
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
    for (let name of ['onDidOpenTerminal', 'onDidCloseTerminal']) {
      Object.defineProperty(this, name, {
        get: () => {
          let stack = '\n' + Error().stack.split('\n').slice(2, 4).join('\n')
          logger.warn(`workspace.${name} is deprecated, please use window.${name} instead.`, stack)
          return window[name]
        }
      })
    }
    let env = this._env = await nvim.call('coc#util#vim_info') as Env
    window.init(env)
    this.checkVersion(APIVERSION)
    this.configurations.updateMemoryConfig(this._env.config)
    this.workspaceFolderControl.setWorkspaceFolders(this._env.workspaceFolders)
    this.workspaceFolderControl.onDidChangeWorkspaceFolders(() => {
      nvim.setVar('WorkspaceFolders', this.folderPaths, true)
    })
    this.files.attach(nvim, env, window)
    this.contentProvider.attach(nvim)
    this.registerTextDocumentContentProvider('output', channels.getProvider(nvim))
    this.keymaps.attach(nvim)
    this.autocmds.attach(nvim, env)
    this.watchers.attach(nvim, env)
    await this.documentsManager.attach(this.nvim, this._env)
    await this.editors.attach(nvim)
    let channel = channels.create('watchman', nvim)
    this.fileSystemWatchers.attach(channel)
    if (this.strWdith) this.strWdith.setAmbw(!env.ambiguousIsNarrow)
  }

  public checkVersion(version: number) {
    if (this._env.apiversion != version) {
      this.nvim.echoError(`API version ${this._env.apiversion} is not ${APIVERSION}, please build coc.nvim by 'yarn install' after pull source code.`)
    }
  }

  public getDisplayWidth(text: string, cache = false): number {
    return this.strWdith.getWidth(text, cache)
  }

  public get version(): string {
    return VERSION
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

  /**
   * @deprecated
   */
  public get insertMode(): boolean {
    return events.insertMode
  }

  /**
   * @deprecated always true
   */
  public get floatSupported(): boolean {
    return true
  }

  /**
   * @deprecated
   */
  public get uri(): string {
    return this.documentsManager.uri
  }

  /**
   * @deprecated
   */
  public get workspaceFolder(): WorkspaceFolder {
    return this.workspaceFolders[0]
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

  public get workspaceFolders(): ReadonlyArray<WorkspaceFolder> {
    return this.workspaceFolderControl.workspaceFolders
  }

  public checkPatterns(patterns: string[], folders?: WorkspaceFolder[]): Promise<boolean> {
    return this.workspaceFolderControl.checkPatterns(folders ?? this.workspaceFolderControl.workspaceFolders, patterns)
  }

  public get folderPaths(): string[] {
    return this.workspaceFolders.map(f => URI.parse(f.uri).fsPath)
  }

  public get channelNames(): string[] {
    return channels.names
  }

  public get pluginRoot(): string {
    return pluginRoot
  }

  public get isVim(): boolean {
    return this._env.isVim
  }

  public get isNvim(): boolean {
    return !this._env.isVim
  }

  /**
   * Keeped for backward compatible
   */
  public get completeOpt(): string {
    return ''
  }

  public get filetypes(): Set<string> {
    return this.documentsManager.filetypes
  }

  public get languageIds(): Set<string> {
    return this.documentsManager.languageIds
  }

  /**
   * @deprecated
   */
  public createNameSpace(name: string): number {
    return createNameSpace(name)
  }

  public has(feature: string): boolean {
    return has(this.env, feature)
  }

  /**
   * Register autocmd on vim.
   */
  public registerAutocmd(autocmd: Autocmd): Disposable {
    if (autocmd.request && autocmd.event !== 'BufWritePre') {
      let name = parseExtensionName(Error().stack)
      logger.warn(`Extension "${name}" registered synchronized autocmd "${autocmd.event}", which could be slow.`)
    }
    return this.autocmds.registerAutocmd(autocmd)
  }

  /**
   * Watch for option change.
   */
  public watchOption(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): Disposable {
    return this.watchers.watchOption(key, callback, disposables)
  }

  /**
   * Watch global variable, works on neovim only.
   */
  public watchGlobal(key: string, callback?: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): Disposable {
    let cb = callback ?? function() {}
    return this.watchers.watchGlobal(key, cb, disposables)
  }

  /**
   * Check if selector match document.
   */
  public match(selector: DocumentSelector, document: TextDocumentMatch): number {
    return score(selector, document.uri, document.languageId)
  }

  /**
   * Create a FileSystemWatcher instance, doesn't fail when watchman not found.
   */
  public createFileSystemWatcher(globPattern: GlobPattern, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher {
    return this.fileSystemWatchers.createFileSystemWatcher(globPattern, ignoreCreate, ignoreChange, ignoreDelete)
  }

  public createFuzzyMatch(): FuzzyMatch {
    return new FuzzyMatch(this.fuzzyExports)
  }

  public getWatchmanPath(): string | null {
    return getWatchmanPath(this.configurations)
  }

  /**
   * Get configuration by section and optional resource uri.
   */
  public getConfiguration(section?: string, scope?: ConfigurationResourceScope): WorkspaceConfiguration {
    return this.configurations.getConfiguration(section, scope)
  }

  public resolveJSONSchema(uri: string): IJSONSchema | undefined {
    return this.configurations.getJSONSchema(uri)
  }

  /**
   * Get created document by uri or bufnr.
   */
  public getDocument(uri: number | string): Document | null {
    return this.documentsManager.getDocument(uri)
  }

  public hasDocument(uri: string, version?: number): boolean {
    let doc = this.documentsManager.getDocument(uri)
    return doc != null && (version != null ? doc.version == version : true)
  }

  public getUri(bufnr: number, defaultValue = ''): string {
    let doc = this.documentsManager.getDocument(bufnr)
    return doc ? doc.uri : defaultValue
  }

  public isAttached(bufnr: number): boolean {
    let doc = this.documentsManager.getDocument(bufnr)
    return doc != null && doc.attached
  }

  /**
   * Get attached document by uri or bufnr.
   * Throw error when document doesn't exist or isn't attached.
   */
  public getAttachedDocument(uri: number | string): Document {
    let doc = this.getDocument(uri)
    if (!doc) throw new Error(`Buffer ${uri} not created.`)
    if (!doc.attached) throw new Error(`Buffer ${uri} not attached, ${doc.notAttachReason}`)
    return doc
  }
  /**
   * Convert location to quickfix item.
   */
  public getQuickfixItem(loc: Location | LocationLink, text?: string, type = '', module?: string): Promise<QuickfixItem> {
    return this.documentsManager.getQuickfixItem(loc, text, type, module)
  }

  /**
   * Create persistence Mru instance.
   */
  public createMru(name: string): Mru {
    return new Mru(name)
  }

  public async getQuickfixList(locations: Location[]): Promise<ReadonlyArray<QuickfixItem>> {
    return this.documentsManager.getQuickfixList(locations)
  }

  /**
   * Populate locations to UI.
   */
  public async showLocations(locations: LocationWithTarget[]): Promise<void> {
    await this.documentsManager.showLocations(locations)
  }

  /**
   * Get content of line by uri and line.
   */
  public getLine(uri: string, line: number): Promise<string> {
    return this.documentsManager.getLine(uri, line)
  }

  /**
   * Get WorkspaceFolder of uri
   */
  public getWorkspaceFolder(uri: string | URI): WorkspaceFolder | undefined {
    return this.workspaceFolderControl.getWorkspaceFolder(typeof uri === 'string' ? URI.parse(uri) : uri)
  }

  /**
   * Get content from buffer or file by uri.
   */
  public readFile(uri: string): Promise<string> {
    return this.documentsManager.readFile(uri)
  }

  public async getCurrentState(): Promise<{ document: LinesTextDocument, position: Position }> {
    let document = await this.document
    let position = await ui.getCursorPosition(this.nvim)
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
  public resolveModule(name: string): Promise<string> {
    return resolveModule(name)
  }

  /**
   * Run nodejs command
   */
  public async runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string> {
    return runCommand(cmd, { cwd: cwd ?? this.cwd }, timeout)
  }

  /**
   * Expand filepath with `~` and/or environment placeholders
   */
  public expand(filepath: string): string {
    return this.documentsManager.expand(filepath)
  }

  public async callAsync<T>(method: string, args: any[]): Promise<T> {
    return await callAsync(this.nvim, method, args)
  }

  public registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable {
    return this.contentProvider.registerTextDocumentContentProvider(scheme, provider)
  }

  public registerKeymap(modes: MapMode[], key: string, fn: Function, opts: Partial<KeymapOption> = {}): Disposable {
    return this.keymaps.registerKeymap(modes, key, fn, opts)
  }

  public registerExprKeymap(mode: 'i' | 'n' | 'v' | 's' | 'x', key: string, fn: Function, buffer = false, cancel = true): Disposable {
    return this.keymaps.registerExprKeymap(mode, key, fn, buffer, cancel)
  }

  public registerLocalKeymap(bufnr: number, mode: LocalMode, key: string, fn: Function, notify = false): Disposable {
    if (typeof arguments[0] === 'string') {
      bufnr = this.bufnr
      mode = arguments[0] as LocalMode
      key = arguments[1]
      fn = arguments[2]
      notify = arguments[3] ?? false
    }
    return this.keymaps.registerLocalKeymap(bufnr, mode, key, fn, notify)
  }

  /**
   * Create Task instance that runs in vim.
   */
  public createTask(id: string): Task {
    return new Task(this.nvim, id)
  }

  /**
   * Create DB instance at extension root.
   */
  public createDatabase(name: string): DB {
    return new DB(path.join(dataHome, name + '.json'))
  }

  public registerBufferSync<T extends SyncItem>(create: (doc: Document) => T | undefined): BufferSync<T> {
    return new BufferSync(create, this.documentsManager)
  }

  public async attach(): Promise<void> {
    await this.documentsManager.attach(this.nvim, this._env)
  }

  public jumpTo(uri: string | URI, position?: Position | null, openCommand?: string): Promise<void> {
    return this.files.jumpTo(uri, position, openCommand)
  }

  /**
   * Findup for filename or filenames from current filepath or root.
   */
  public findUp(filename: string | string[]): Promise<string | null> {
    return findUp(this.nvim, this.cwd, filename)
  }

  /**
   * Apply WorkspaceEdit.
   */
  public applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    return this.files.applyEdit(edit)
  }

  /**
   * Create a file in vim and disk
   */
  public createFile(filepath: string, opts: CreateFileOptions = {}): Promise<void> {
    return this.files.createFile(filepath, opts)
  }

  /**
   * Load uri as document.
   */
  public loadFile(uri: string, cmd?: string): Promise<Document> {
    return this.files.loadResource(uri, cmd)
  }

  /**
   * Load the files that not loaded
   */
  public async loadFiles(uris: string[]): Promise<(Document | undefined)[]> {
    return this.files.loadResources(uris)
  }

  /**
   * Rename file in vim and disk
   */
  public async renameFile(oldPath: string, newPath: string, opts: RenameFileOptions = {}): Promise<void> {
    await this.files.renameFile(oldPath, newPath, opts)
  }

  /**
   * Delete file from vim and disk.
   */
  public async deleteFile(filepath: string, opts: DeleteFileOptions = {}): Promise<void> {
    await this.files.deleteFile(filepath, opts)
  }

  /**
   * Open resource by uri
   */
  public async openResource(uri: string): Promise<void> {
    await this.files.openResource(uri)
  }

  public async computeWordRanges(uri: string | number, range: Range, token?: CancellationToken): Promise<{ [word: string]: Range[] } | null> {
    let doc = this.getDocument(uri)
    if (!doc) return null
    return await doc.chars.computeWordRanges(doc.textDocument.lines, range, token)
  }

  public openTextDocument(uri: URI | string): Promise<Document> {
    return this.files.openTextDocument(uri)
  }

  public getRelativePath(pathOrUri: string | URI, includeWorkspace?: boolean): string {
    return this.workspaceFolderControl.getRelativePath(pathOrUri, includeWorkspace)
  }

  public async findFiles(include: GlobPattern, exclude?: GlobPattern | null, maxResults?: number, token?: CancellationToken): Promise<URI[]> {
    return this.files.findFiles(include, exclude, maxResults, token)
  }

  public detach(): void {
    this.documentsManager.detach()
  }

  public reset(): void {
    this.statusLine.reset()
    this.configurations.reset()
    this.workspaceFolderControl.reset()
    this.documentsManager.reset()
  }

  public dispose(): void {
    channels.dispose()
    this.autocmds.dispose()
    this.statusLine.dispose()
    this.watchers.dispose()
    this.contentProvider.dispose()
    this.documentsManager.dispose()
    this.configurations.dispose()
  }
}

export default new Workspace()
