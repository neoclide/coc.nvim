import { Buffer, NeovimClient as Neovim } from '@chemzqm/neovim'
import bytes from 'bytes'
import fastDiff from 'fast-diff'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { v1 as uuid } from 'uuid'
import { CancellationTokenSource, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Disposable, DocumentSelector, Emitter, Event, FormattingOptions, Location, LocationLink, Position, Range, RenameFile, RenameFileOptions, TextDocumentEdit, TextDocumentSaveReason, TextEdit, WorkspaceEdit, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import which from 'which'
import channels from './channels'
import Configurations from './configuration'
import ConfigurationShape from './configuration/shape'
import events from './events'
import DB from './model/db'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import Mru from './model/mru'
import Resolver from './model/resolver'
import Task from './model/task'
import TerminalModel, { TerminalOptions } from './model/terminal'
import BufferSync, { SyncItem } from './model/bufferSync'
import { TextDocumentContentProvider } from './provider'
import { ConfigurationChangeEvent, ConfigurationTarget, DidChangeTextDocumentParams, DocumentChange, EditerState, Env, FileCreateEvent, FileDeleteEvent, FileRenameEvent, FileWillCreateEvent, FileWillDeleteEvent, FileWillRenameEvent, IWorkspace, OutputChannel, PatternType, QuickfixItem, TextDocumentWillSaveEvent, WorkspaceConfiguration } from './types'
import { distinct } from './util/array'
import { findUp, fixDriver, inDirectory, isFile, isParentFolder, readFileLine, renameAsync, resolveRoot, statAsync } from './util/fs'
import { CONFIG_FILE_NAME, disposeAll, getKeymapModifier, platform, runCommand, wait, MapMode } from './util/index'
import { score } from './util/match'
import { getChangedFromEdits } from './util/position'
import { byteIndex, byteLength } from './util/string'
import Watchman from './watchman'
import window from './window'
import { version as VERSION } from '../package.json'

export interface KeymapOption {
  sync: boolean
  cancel: boolean
  silent: boolean
  repeat: boolean
}

export interface Autocmd {
  pattern?: string
  event: string | string[]
  arglist?: string[]
  request?: boolean
  thisArg?: any
  callback: Function
}

const APIVERSION = 9
const logger = require('./util/logger')('workspace')
let NAME_SPACE = 2000
const methods = [
  'showMessage',
  'runTerminalCommand',
  'openTerminal',
  'showQuickpick',
  'menuPick',
  'openLocalConfig',
  'showPrompt',
  'createStatusBarItem',
  'createOutputChannel',
  'showOutputChannel',
  'requestInput',
  'echoLines',
  'getCursorPosition',
  'moveTo',
  'getOffset']

export class Workspace implements IWorkspace {
  public readonly nvim: Neovim
  public readonly version: string
  public readonly keymaps: Map<string, [Function, boolean]> = new Map()
  public bufnr: number
  private maxFileSize: number
  private resolver: Resolver = new Resolver()
  private rootPatterns: Map<string, string[]> = new Map()
  private _workspaceFolders: WorkspaceFolder[] = []
  private _insertMode = false
  private _env: Env
  private _root: string
  private _cwd = process.cwd()
  private _initialized = false
  private _attached = false
  private buffers: Map<number, Document> = new Map()
  private autocmdMaxId = 0
  private autocmds: Map<number, Autocmd> = new Map()
  private terminals: Map<number, TerminalModel> = new Map()
  private creatingSources: Map<number, CancellationTokenSource> = new Map()
  private schemeProviderMap: Map<string, TextDocumentContentProvider> = new Map()
  private namespaceMap: Map<string, number> = new Map()
  private disposables: Disposable[] = []
  private watchedOptions: Set<string> = new Set()

  private _dynAutocmd = false
  private _disposed = false
  private _onDidOpenDocument = new Emitter<TextDocument & { bufnr: number }>()
  private _onDidCloseDocument = new Emitter<TextDocument & { bufnr: number }>()
  private _onDidChangeDocument = new Emitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new Emitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new Emitter<TextDocument>()
  private _onDidChangeWorkspaceFolders = new Emitter<WorkspaceFoldersChangeEvent>()
  private _onDidChangeConfiguration = new Emitter<ConfigurationChangeEvent>()
  private _onDidWorkspaceInitialized = new Emitter<void>()
  private _onDidOpenTerminal = new Emitter<TerminalModel>()
  private _onDidCloseTerminal = new Emitter<TerminalModel>()
  private _onDidRuntimePathChange = new Emitter<string[]>()

  public readonly onDidCloseTerminal: Event<TerminalModel> = this._onDidCloseTerminal.event
  public readonly onDidOpenTerminal: Event<TerminalModel> = this._onDidOpenTerminal.event
  public readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent> = this._onDidChangeWorkspaceFolders.event
  public readonly onDidOpenTextDocument: Event<TextDocument & { bufnr: number }> = this._onDidOpenDocument.event
  public readonly onDidCloseTextDocument: Event<TextDocument & { bufnr: number }> = this._onDidCloseDocument.event
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveDocument.event
  public readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent> = this._onDidChangeConfiguration.event
  public readonly onDidWorkspaceInitialized: Event<void> = this._onDidWorkspaceInitialized.event
  public readonly onDidRuntimePathChange: Event<string[]> = this._onDidRuntimePathChange.event
  public readonly configurations: Configurations

  private _onDidCreateFiles = new Emitter<FileCreateEvent>()
  private _onDidRenameFiles = new Emitter<FileRenameEvent>()
  private _onDidDeleteFiles = new Emitter<FileDeleteEvent>()
  private _onWillCreateFiles = new Emitter<FileWillCreateEvent>()
  private _onWillRenameFiles = new Emitter<FileWillRenameEvent>()
  private _onWillDeleteFiles = new Emitter<FileWillDeleteEvent>()

  public readonly onDidCreateFiles: Event<FileCreateEvent> = this._onDidCreateFiles.event
  public readonly onDidRenameFiles: Event<FileRenameEvent> = this._onDidRenameFiles.event
  public readonly onDidDeleteFiles: Event<FileDeleteEvent> = this._onDidDeleteFiles.event
  public readonly onWillCreateFiles: Event<FileWillCreateEvent> = this._onWillCreateFiles.event
  public readonly onWillRenameFiles: Event<FileWillRenameEvent> = this._onWillRenameFiles.event
  public readonly onWillDeleteFiles: Event<FileWillDeleteEvent> = this._onWillDeleteFiles.event

  constructor() {
    this.version = VERSION
    this.configurations = this.createConfigurations()
    let cwd = process.cwd()
    if (cwd != os.homedir() && inDirectory(cwd, ['.vim'])) {
      this._workspaceFolders.push({
        uri: URI.file(cwd).toString(),
        name: path.basename(cwd)
      })
    }
  }

  public async init(): Promise<void> {
    let { nvim } = this
    for (let method of methods) {
      Object.defineProperty(this, method, {
        get: () => {
          return (...args: any[]) => {
            // logger.warn(`workspace.${method} is deprecated, please use window.${method} instead.`, Error().stack)
            return window[method].apply(window, args)
          }
        }
      })
    }
    this._env = await nvim.call('coc#util#vim_info') as Env
    if (this._env.apiversion != APIVERSION) {
      console.error(`API version ${this._env.apiversion} is not ${APIVERSION}, please build coc.nvim by 'yarn install' after pull source code.`)
      process.exit()
    }
    this._insertMode = this._env.mode.startsWith('insert')
    let preferences = this.getConfiguration('coc.preferences')
    let maxFileSize = preferences.get<string>('maxFileSize', '10MB')
    this.maxFileSize = bytes.parse(maxFileSize)
    if (this._env.workspaceFolders && Array.isArray(this._env.workspaceFolders)) {
      this._workspaceFolders = this._env.workspaceFolders.map(f => ({
        uri: URI.file(f).toString(),
        name: path.dirname(f)
      }))
    }
    this.configurations.updateUserConfig(this._env.config)
    events.on(['InsertEnter', 'CursorMovedI'], () => {
      this._insertMode = true
    }, null, this.disposables)
    events.on(['InsertLeave', 'CursorMoved'], () => {
      this._insertMode = false
    }, null, this.disposables)
    let forceSync = async bufnr => {
      let doc = this.getDocument(bufnr)
      if (doc) doc.forceSync()
    }
    events.on('InsertLeave', forceSync, null, this.disposables)
    events.on('CursorHold', forceSync, null, this.disposables)
    events.on('BufEnter', this.onBufEnter, this, this.disposables)
    events.on('CursorMoved', this.checkCurrentBuffer, this, this.disposables)
    events.on('CursorMovedI', this.checkCurrentBuffer, this, this.disposables)
    events.on('DirChanged', this.onDirChanged, this, this.disposables)
    events.on('BufCreate', this.onBufCreate, this, this.disposables)
    events.on('BufUnload', this.onBufUnload, this, this.disposables)
    events.on('TermOpen', this.onBufCreate, this, this.disposables)
    events.on('TermClose', this.onBufUnload, this, this.disposables)
    events.on('BufWritePost', this.onBufWritePost, this, this.disposables)
    events.on('BufWritePre', this.onBufWritePre, this, this.disposables)
    events.on('FileType', this.onFileTypeChange, this, this.disposables)
    events.on('CursorHold', this.checkCurrentBuffer, this, this.disposables)
    events.on('TextChanged', this.checkBuffer, this, this.disposables)
    events.on('BufReadCmd', this.onBufReadCmd, this, this.disposables)
    events.on('VimResized', (columns, lines) => {
      Object.assign(this._env, { columns, lines })
    }, null, this.disposables)
    await this.attach()
    this.attachChangedEvents()
    this.configurations.onDidChange(e => {
      this._onDidChangeConfiguration.fire(e)
    }, null, this.disposables)
    this.watchOption('runtimepath', (oldValue, newValue: string) => {
      let result = fastDiff(oldValue, newValue)
      for (let [changeType, value] of result) {
        if (changeType == 1) {
          let paths = value.replace(/,$/, '').split(',')
          this._onDidRuntimePathChange.fire(paths)
        }
      }
      this._env.runtimepath = newValue
    }, this.disposables)
    this.watchGlobal('coc_sources_disable_map', async (_, newValue) => {
      this.env.disabledSources = newValue
    })
    this.disposables.push(this.registerTextDocumentContentProvider('output', channels.getProvider(nvim)))
  }

  public getConfigFile(target: ConfigurationTarget): string {
    return this.configurations.getConfigFile(target)
  }

  /**
   * Register autocmd on vim.
   */
  public registerAutocmd(autocmd: Autocmd): Disposable {
    this.autocmdMaxId += 1
    let id = this.autocmdMaxId
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
   *
   * @deprecated this method is reliable, will be removed in the feature.
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
      uri: URI.file(rootPath).toString(),
      name: path.basename(rootPath)
    }
  }

  public get textDocuments(): TextDocument[] {
    let docs: TextDocument[] = []
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
    let res = new Set<string>()
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
    if (isFile && !isParentFolder(cwd, filepath, true)) {
      // can't use cwd
      return findUp(filename, path.dirname(filepath))
    }
    let res = findUp(filename, cwd)
    if (res && res != os.homedir()) return res
    if (isFile) return findUp(filename, path.dirname(filepath))
    return null
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  public async resolveRootFolder(uri: URI, patterns: string[]): Promise<string> {
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
    let watchmanPath = global.hasOwnProperty('__TEST__') ? null : this.getWatchmanPath()
    let channel: OutputChannel = watchmanPath ? window.createOutputChannel('watchman') : null
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
    const caseInsensitive = platform.isWindows || platform.isMacintosh
    uri = URI.parse(uri).toString()
    for (let doc of this.buffers.values()) {
      if (!doc) continue
      if (doc.uri === uri) return doc
      if (path.resolve(doc.uri) === path.resolve(uri)) return doc
      if (caseInsensitive && doc.uri.toLowerCase() === uri.toLowerCase()) return doc
    }
    return null
  }

  /**
   * Apply WorkspaceEdit.
   */
  public async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    let { nvim } = this
    let { documentChanges, changes } = edit
    let [bufnr, cursor] = await nvim.eval('[bufnr("%"),coc#util#cursor()]') as [number, [number, number]]
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
        let items = await Promise.all(locations.map(loc => this.getQuickfixItem(loc)))
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
   * Convert location to quickfix item.
   */
  public async getQuickfixItem(loc: Location | LocationLink, text?: string, type = '', module?: string): Promise<QuickfixItem> {
    if (LocationLink.is(loc)) {
      loc = Location.create(loc.targetUri, loc.targetRange)
    }
    let doc = this.getDocument(loc.uri)
    let { uri, range } = loc
    let { line, character } = range.start
    let u = URI.parse(uri)
    let bufnr = doc ? doc.bufnr : -1
    if (!text && u.scheme == 'file') {
      text = await this.getLine(uri, line)
      character = byteIndex(text, character)
    }
    let item: QuickfixItem = {
      uri,
      filename: u.scheme == 'file' ? u.fsPath : uri,
      lnum: line + 1,
      col: character + 1,
      text: text || '',
      range
    }
    if (module) item.module = module
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
      let [line, character] = await nvim.eval("coc#util#cursor()") as [number, number]
      return Range.create(line, character, line, character)
    }
    if (!['v', 'V', 'char', 'line', '\x16'].includes(mode)) {
      throw new Error(`Mode '${mode}' not supported`)
    }
    let isVisual = ['v', 'V', '\x16'].includes(mode)
    let [, sl, sc] = await nvim.call('getpos', isVisual ? `'<` : `'[`) as [number, number, number]
    let [, el, ec] = await nvim.call('getpos', isVisual ? `'>` : `']`) as [number, number, number]
    let range = Range.create(document.getPosition(sl, sc), document.getPosition(el, ec))
    if (mode == 'v' || mode == '\x16') {
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
   * Populate locations to UI.
   */
  public async showLocations(locations: Location[]): Promise<void> {
    let items = await Promise.all(locations.map(loc => this.getQuickfixItem(loc)))
    let { nvim } = this
    const preferences = this.getConfiguration('coc.preferences')
    if (preferences.get<boolean>('useQuickfixForLocations', false)) {
      let openCommand = await nvim.getVar('coc_quickfix_open_command') as string
      if (typeof openCommand != 'string') {
        openCommand = items.length < 10 ? `copen ${items.length}` : 'copen'
      }
      nvim.pauseNotification()
      nvim.call('setqflist', [items], true)
      nvim.command(openCommand, true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    } else {
      await nvim.setVar('coc_jump_locations', items)
      if (this.env.locationlist) {
        nvim.command('CocList --normal --auto-preview location', true)
      } else {
        nvim.call('coc#util#do_autocmd', ['CocLocationsChange'], true)
      }
    }
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
   * Get WorkspaceFolder of uri
   */
  public getWorkspaceFolder(uri: string): WorkspaceFolder | null {
    this.workspaceFolders.sort((a, b) => b.uri.length - a.uri.length)
    let filepath = URI.parse(uri).fsPath
    return this.workspaceFolders.find(folder => isParentFolder(URI.parse(folder.uri).fsPath, filepath, true))
  }

  /**
   * Get content from buffer of file by uri.
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

  /**
   * Current document.
   */
  public get document(): Promise<Document> {
    return new Promise<Document>((resolve, reject) => {
      this.nvim.buffer.then(buf => {
        let bufnr = buf.id
        this.bufnr = bufnr
        if (this.buffers.has(bufnr)) {
          resolve(this.buffers.get(bufnr))
          return
        }
        this.onBufCreate(bufnr).catch(reject)
        let disposable = this.onDidOpenTextDocument(doc => {
          disposable.dispose()
          resolve(this.getDocument(doc.uri))
        })
      }, reject)
    })
  }

  /**
   * Get current document and position.
   */
  public async getCurrentState(): Promise<EditerState> {
    let document = await this.document
    let position = await window.getCursorPosition()
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
    if (uri) doc = this.getDocument(uri)
    let bufnr = doc ? doc.bufnr : 0
    let [tabSize, insertSpaces] = await this.nvim.call('coc#util#get_format_opts', [bufnr]) as [number, number]
    return {
      tabSize,
      insertSpaces: insertSpaces == 1
    } as FormattingOptions
  }

  /**
   * Jump to location.
   */
  public async jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void> {
    const preferences = this.getConfiguration('coc.preferences')
    let jumpCommand = openCommand || preferences.get<string>('jumpCommand', 'edit')
    let { nvim } = this
    let doc = this.getDocument(uri)
    let bufnr = doc ? doc.bufnr : -1
    if (bufnr != -1 && jumpCommand == 'edit') {
      // use buffer command since edit command would reload the buffer
      nvim.pauseNotification()
      nvim.command(`silent! normal! m'`, true)
      nvim.command(`buffer ${bufnr}`, true)
      if (position) {
        let line = doc.getline(position.line)
        let col = byteLength(line.slice(0, position.character)) + 1
        nvim.call('cursor', [position.line + 1, col], true)
      }
      if (this.isVim) nvim.command('redraw', true)
      await nvim.resumeNotification()
    } else {
      let { fsPath, scheme } = URI.parse(uri)
      let pos = position == null ? null : [position.line, position.character]
      if (scheme == 'file') {
        let bufname = fixDriver(path.normalize(fsPath))
        await this.nvim.call('coc#util#jump', [jumpCommand, bufname, pos])
      } else {
        if (os.platform() == 'win32') {
          uri = uri.replace(/\/?/, '?')
        }
        await this.nvim.call('coc#util#jump', [jumpCommand, uri, pos])
      }
    }
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
    if (!filepath) return filepath
    if (filepath.startsWith('~')) {
      filepath = os.homedir() + filepath.slice(1)
    }
    if (filepath.includes('$')) {
      let doc = this.getDocument(this.bufnr)
      let fsPath = doc ? URI.parse(doc.uri).fsPath : ''
      filepath = filepath.replace(/\$\{(.*?)\}/g, (match: string, name: string) => {
        if (name.startsWith('env:')) {
          let key = name.split(':')[1]
          let val = key ? process.env[key] : ''
          return val
        }
        switch (name) {
          case 'workspace':
          case 'workspaceRoot':
          case 'workspaceFolder':
            return this.root
          case 'workspaceFolderBasename':
            return path.dirname(this.root)
          case 'cwd':
            return this.cwd
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
      filepath = filepath.replace(/\$[\w]+/g, match => {
        if (match == '$HOME') return os.homedir()
        return process.env[match.slice(1)] || match
      })
    }
    return filepath
  }

  public async createTerminal(opts: TerminalOptions): Promise<TerminalModel> {
    let cmd = opts.shellPath
    let args = opts.shellArgs
    if (!cmd) cmd = await this.nvim.getOption('shell') as string
    let terminal = new TerminalModel(cmd, args || [], this.nvim, opts.name)
    await terminal.start(opts.cwd || this.cwd, opts.env)
    this.terminals.set(terminal.bufnr, terminal)
    this._onDidOpenTerminal.fire(terminal)
    return terminal
  }

  public async callAsync<T>(method: string, args: any[]): Promise<T> {
    if (this.isNvim) return await this.nvim.call(method, args)
    return await this.nvim.callAsync('coc#util#with_callback', [method, args])
  }

  /**
   * registerTextDocumentContentProvider
   */
  public registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable {
    this.schemeProviderMap.set(scheme, provider)
    this.setupDynamicAutocmd()
    let disposables: Disposable[] = []
    if (provider.onDidChange) {
      provider.onDidChange(async uri => {
        let doc = this.getDocument(uri.toString())
        if (doc) {
          let { buffer } = doc
          let tokenSource = new CancellationTokenSource()
          let content = await Promise.resolve(provider.provideTextDocumentContent(uri, tokenSource.token))
          await buffer.setLines(content.split(/\r?\n/), {
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
    if (!key) throw new Error(`Invalid key ${key} of registerKeymap`)
    if (this.keymaps.has(key)) throw new Error(`${key} already exists.`)
    opts = Object.assign({ sync: true, cancel: true, silent: true, repeat: false }, opts)
    let { nvim } = this
    this.keymaps.set(key, [fn, !!opts.repeat])
    let method = opts.sync ? 'request' : 'notify'
    let silent = opts.silent ? '<silent>' : ''
    for (let m of modes) {
      if (m == 'i') {
        nvim.command(`inoremap ${silent}<expr> <Plug>(coc-${key}) coc#_insert_key('${method}', '${key}', ${opts.cancel ? 1 : 0})`, true)
      } else {
        let modify = getKeymapModifier(m)
        nvim.command(`${m}noremap ${silent} <Plug>(coc-${key}) :${modify}call coc#rpc#${method}('doKeymap', ['${key}'])<cr>`, true)
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
    if (!key) return
    let id = `${mode}${global.Buffer.from(key).toString('base64')}${buffer ? '1' : '0'}`
    let { nvim } = this
    this.keymaps.set(id, [fn, false])
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

  public registerLocalKeymap(mode: 'n' | 'v' | 's' | 'x', key: string, fn: Function, notify = false): Disposable {
    let id = uuid()
    let { nvim, bufnr } = this
    this.keymaps.set(id, [fn, false])
    let method = notify ? 'notify' : 'request'
    let modify = getKeymapModifier(mode)
    // neoivm's bug '<' can't be used.
    let escaped = key.startsWith('<') && key.endsWith('>') ? `{${key.slice(1, -1)}}` : key
    if (this.isNvim && !global.hasOwnProperty('__TEST__')) {
      nvim.call('nvim_buf_set_keymap', [0, mode, key, `:${modify}call coc#rpc#${method}('doKeymap', ['${id}', '', '${escaped}'])<CR>`, {
        silent: true,
        nowait: true
      }], true)
    } else {
      let cmd = `${mode}noremap <silent><nowait><buffer> ${key} :${modify}call coc#rpc#${method}('doKeymap', ['${id}', '', '${escaped}'])<CR>`
      nvim.command(cmd, true)
    }
    return Disposable.create(() => {
      this.keymaps.delete(id)
      nvim.call('coc#compat#buf_del_keymap', [bufnr, mode, key], true)
    })
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

  /**
   * Create Task instance that runs in vim.
   */
  public createTask(id: string): Task {
    return new Task(this.nvim, id)
  }

  public registerBufferSync<T extends SyncItem>(create: (doc: Document) => T | undefined): BufferSync<T> {
    return new BufferSync(create, this)
  }

  public setupDynamicAutocmd(initialize = false): void {
    if (!initialize && !this._dynAutocmd) return
    this._dynAutocmd = true
    let schemes = this.schemeProviderMap.keys()
    let cmds: string[] = []
    for (let scheme of schemes) {
      cmds.push(`autocmd BufReadCmd,FileReadCmd,SourceCmd ${scheme}:/* call coc#rpc#request('CocAutocmd', ['BufReadCmd','${scheme}', expand('<amatch>')])`)
    }
    for (let [id, autocmd] of this.autocmds.entries()) {
      let args = autocmd.arglist && autocmd.arglist.length ? ', ' + autocmd.arglist.join(', ') : ''
      let event = Array.isArray(autocmd.event) ? autocmd.event.join(',') : autocmd.event
      let pattern = autocmd.pattern != null ? autocmd.pattern : '*'
      if (/\buser\b/i.test(event)) {
        pattern = ''
      }
      cmds.push(`autocmd ${event} ${pattern} call coc#rpc#${autocmd.request ? 'request' : 'notify'}('doAutocmd', [${id}${args}])`)
    }
    for (let key of this.watchedOptions) {
      cmds.push(`autocmd OptionSet ${key} call coc#rpc#notify('OptionSet',[expand('<amatch>'), v:option_old, v:option_new])`)
    }
    let content = `
augroup coc_dynamic_autocmd
  autocmd!
  ${cmds.join('\n  ')}
augroup end`
    try {
      let dir = path.join(process.env.TMPDIR, `coc.nvim-${process.pid}`)
      if (!fs.existsSync(dir)) fs.mkdirpSync(dir)
      let filepath = path.join(dir, `coc-${process.pid}.vim`)
      fs.writeFileSync(filepath, content, 'utf8')
      let cmd = `source ${filepath}`
      if (this.env.isCygwin && platform.isWindows) {
        cmd = `execute "source" . substitute(system('cygpath ${filepath.replace(/\\/g, '/')}'), '\\n', '', 'g')`
      }
      this.nvim.command(cmd).logError()
    } catch (e) {
      window.showMessage(`Can't create tmp file: ${e.message}`, 'error')
    }
  }

  private async onBufReadCmd(scheme: string, uri: string): Promise<void> {
    let provider = this.schemeProviderMap.get(scheme)
    if (!provider) {
      window.showMessage(`Provider for ${scheme} not found`, 'error')
      return
    }
    let tokenSource = new CancellationTokenSource()
    let content = await Promise.resolve(provider.provideTextDocumentContent(URI.parse(uri), tokenSource.token))
    let buf = await this.nvim.buffer
    await buf.setLines(content.split(/\r?\n/), {
      start: 0,
      end: -1,
      strictIndexing: false
    })
    setTimeout(async () => {
      await events.fire('BufCreate', [buf.id])
    }, 30)
  }

  public async attach(): Promise<void> {
    if (this._attached) return
    this._attached = true
    let [bufs, bufnr, winid] = await this.nvim.eval(`[map(getbufinfo({'bufloaded': 1}),'v:val["bufnr"]'),bufnr('%'),win_getid()]`) as [number[], number, number]
    this.bufnr = bufnr
    await Promise.all(bufs.map(buf => this.onBufCreate(buf)))
    if (!this._initialized) {
      this._onDidWorkspaceInitialized.fire(void 0)
      this._initialized = true
    }
    await events.fire('BufEnter', [bufnr])
    await events.fire('BufWinEnter', [bufnr, winid])
  }

  // count of document need change
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

  private createConfigurations(): Configurations {
    let home = path.normalize(process.env.COC_VIMCONFIG) || path.join(os.homedir(), '.vim')
    let userConfigFile = path.join(home, CONFIG_FILE_NAME)
    return new Configurations(userConfigFile, new ConfigurationShape(this))
  }

  // events for sync buffer of vim
  private attachChangedEvents(): void {
    if (this.isVim) {
      const onChange = (bufnr: number) => {
        let doc = this.getDocument(bufnr)
        if (doc && doc.attached) doc.fetchContent()
      }
      events.on('TextChangedI', onChange, null, this.disposables)
      events.on('TextChanged', onChange, null, this.disposables)
    }
  }

  private async onBufCreate(buf: number | Buffer): Promise<void> {
    let buffer = typeof buf === 'number' ? this.nvim.createBuffer(buf) : buf
    let bufnr = buffer.id
    if (this.creatingSources.has(bufnr)) return
    let document = this.getDocument(bufnr)
    let source = new CancellationTokenSource()
    try {
      if (document) this.onBufUnload(bufnr, true)
      document = new Document(buffer, this._env, this.maxFileSize)
      let token = source.token
      this.creatingSources.set(bufnr, source)
      let created = await document.init(this.nvim, token)
      if (!created) document = null
    } catch (e) {
      logger.error('Error on create buffer:', e)
      document = null
    }
    if (this.creatingSources.get(bufnr) == source) {
      source.dispose()
      this.creatingSources.delete(bufnr)
    }
    if (!document || !document.textDocument) return
    this.buffers.set(bufnr, document)
    if (document.attached) {
      document.onDocumentDetach(bufnr => {
        let doc = this.getDocument(bufnr)
        if (doc) this.onBufUnload(doc.bufnr)
      })
    }
    if (document.buftype == '' && document.schema == 'file') {
      this.configurations.checkFolderConfiguration(document.uri)
      let config = this.getConfiguration('workspace')
      let filetypes = config.get<string[]>('ignoredFiletypes', [])
      if (!filetypes.includes(document.filetype)) {
        let root = this.resolveRoot(document)
        if (root) {
          this.addWorkspaceFolder(root)
          if (this.bufnr == buffer.id) {
            this._root = root
          }
        }
      }
    }
    if (document.enabled) {
      let textDocument: TextDocument & { bufnr: number } = Object.assign(document.textDocument, { bufnr })
      this._onDidOpenDocument.fire(textDocument)
      document.onDocumentChange(e => this._onDidChangeDocument.fire(e))
    }
    logger.debug('buffer created', buffer.id)
  }

  private onBufEnter(bufnr: number): void {
    this.bufnr = bufnr
    let doc = this.getDocument(bufnr)
    if (doc) {
      this.configurations.setFolderConfiguration(doc.uri)
      let workspaceFolder = this.getWorkspaceFolder(doc.uri)
      if (workspaceFolder) this._root = URI.parse(workspaceFolder.uri).fsPath
    }
  }

  private async checkCurrentBuffer(bufnr: number): Promise<void> {
    this.bufnr = bufnr
    await this.checkBuffer(bufnr)
  }

  private onBufWritePost(bufnr: number): void {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    this._onDidSaveDocument.fire(doc.textDocument)
  }

  private onBufUnload(bufnr: number, recreate = false): void {
    logger.debug('buffer unload', bufnr)
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
      let textDocument: TextDocument & { bufnr: number } = Object.assign(doc.textDocument, { bufnr })
      this._onDidCloseDocument.fire(textDocument)
      this.buffers.delete(bufnr)
      doc.detach()
    }
  }

  private async onBufWritePre(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc || !doc.attached) return
    await doc.checkDocument()
    let firing = true
    let thenables: Thenable<TextEdit[] | any>[] = []
    let event: TextDocumentWillSaveEvent = {
      document: doc.textDocument,
      reason: TextDocumentSaveReason.Manual,
      waitUntil: (thenable: Thenable<any>) => {
        if (!firing) {
          logger.error(`Can't call waitUntil in async manner:`, Error().stack)
          window.showMessage(`waitUntil can't be used in async manner, check log for details`, 'error')
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
        const preferences = this.getConfiguration('coc.preferences')
        const willSaveHandlerTimeout = preferences.get<number>('willSaveHandlerTimeout', 500)
        let timer = setTimeout(() => {
          window.showMessage(`Will save handler timeout after ${willSaveHandlerTimeout}ms`, 'warning')
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
          }, () => {
            i = i + 1
            if (i == total) cb(undefined)
          })
        }
      })
      let edits = await promise
      if (edits) await doc.applyEdits(edits)
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
    let textDocument: TextDocument & { bufnr: number } = Object.assign(doc.textDocument, { bufnr })
    this._onDidCloseDocument.fire(textDocument)
    doc.setFiletype(filetype)
    this._onDidOpenDocument.fire(Object.assign(doc.textDocument, { bufnr }))
  }

  private async checkBuffer(bufnr: number): Promise<void> {
    if (this._disposed || !bufnr) return
    let doc = this.getDocument(bufnr)
    if (!doc && !this.creatingSources.has(bufnr)) await this.onBufCreate(bufnr)
  }

  private resolveRoot(document: Document): string {
    let types = [PatternType.Buffer, PatternType.LanguageServer, PatternType.Global]
    let u = URI.parse(document.uri)
    let dir = path.dirname(u.fsPath)
    let { cwd } = this
    let config = this.getConfiguration('workspace')
    let bottomUpFileTypes = config.get<string[]>('bottomUpFiletypes', [])
    let checkCwd = config.get<boolean>('workspaceFolderCheckCwd', true)
    for (let patternType of types) {
      let patterns = this.getRootPatterns(document, patternType)
      if (patterns && patterns.length) {
        let isBottomUp = bottomUpFileTypes.includes(document.filetype)
        let root = resolveRoot(dir, patterns, cwd, isBottomUp, checkCwd)
        if (root) return root
      }
    }
    if (this.cwd != os.homedir() && isParentFolder(this.cwd, dir, true)) return this.cwd
    return null
  }

  public getRootPatterns(document: Document, patternType: PatternType): string[] {
    let { uri } = document
    if (patternType == PatternType.Buffer) return document.getVar('root_patterns', []) || []
    if (patternType == PatternType.LanguageServer) return this.getServerRootPatterns(document.filetype)
    const preferences = this.getConfiguration('coc.preferences', uri)
    return preferences.get<string[]>('rootPatterns', ['.git', '.hg', '.projections.json']).slice()
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

  public get folderPaths(): string[] {
    return this.workspaceFolders.map(f => URI.parse(f.uri).fsPath)
  }

  public get floatSupported(): boolean {
    let { env } = this
    return env.floating || env.textprop
  }

  public removeWorkspaceFolder(fsPath: string): void {
    let idx = this._workspaceFolders.findIndex(f => URI.parse(f.uri).fsPath == fsPath)
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
    let idx = this._workspaceFolders.findIndex(f => URI.parse(f.uri).fsPath == oldPath)
    if (idx == -1) return
    let removed = this._workspaceFolders[idx]
    let added: WorkspaceFolder = {
      uri: URI.file(newPath).toString(),
      name: path.dirname(newPath)
    }
    this._workspaceFolders.splice(idx, 1)
    this._workspaceFolders.push(added)
    this._onDidChangeWorkspaceFolders.fire({
      removed: [removed],
      added: [added]
    })
  }

  public addRootPattern(filetype: string, rootPatterns: string[]): void {
    let patterns = this.rootPatterns.get(filetype) || []
    for (let p of rootPatterns) {
      if (!patterns.includes(p)) {
        patterns.push(p)
      }
    }
    this.rootPatterns.set(filetype, patterns)
  }

  public get insertMode(): boolean {
    return this._insertMode
  }

  public async detach(): Promise<void> {
    if (!this._attached) return
    this._attached = false
    channels.dispose()
    for (let bufnr of this.buffers.keys()) {
      await events.fire('BufUnload', [bufnr])
    }
  }

  public dispose(): void {
    this._disposed = true
    for (let doc of this.documents) {
      doc.detach()
    }
    disposeAll(this.disposables)
    Watchman.dispose()
    this.configurations.dispose()
    this.buffers.clear()
  }

  private addWorkspaceFolder(rootPath: string): WorkspaceFolder {
    if (rootPath == os.homedir()) return
    let { _workspaceFolders } = this
    let uri = URI.file(rootPath).toString()
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
    let lspConfig = this.getConfiguration().get<{ [key: string]: unknown }>('languageserver', {})
    let patterns: string[] = []
    for (let key of Object.keys(lspConfig)) {
      let config: any = lspConfig[key]
      let { filetypes, rootPatterns } = config
      if (Array.isArray(filetypes) && rootPatterns && filetypes.includes(filetype)) {
        patterns.push(...rootPatterns)
      }
    }
    patterns = patterns.concat(this.rootPatterns.get(filetype) || [])
    return patterns.length ? distinct(patterns) : null
  }
}

export default new Workspace()
