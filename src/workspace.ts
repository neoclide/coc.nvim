import { Buffer, Neovim } from '@chemzqm/neovim'
import deepEqual from 'deep-equal'
import { EventEmitter } from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DidChangeTextDocumentParams, Disposable, Emitter, Event, FormattingOptions, Location, Position, TextDocument, TextDocumentEdit, TextDocumentSaveReason, TextEdit, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Configurations, { parseContentFromFile } from './configurations'
import { BaseLanguageClient } from './language-client/main'
import ConfigurationShape from './model/configurationShape'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import JobManager from './model/jobManager'
import ModuleManager from './model/moduleManager'
import BufferChannel from './model/outputChannel'
import WillSaveUntilHandler from './model/willSaveHandler'
import Sources from './sources'
import { ChangeInfo, DocumentInfo, EditerState, IConfigurationData, IWorkspace, OutputChannel, QuickfixItem, TerminalResult, TextDocumentWillSaveEvent, WinEnter, WorkspaceConfiguration } from './types'
import { resolveRoot, statAsync, writeFile } from './util/fs'
import { disposeAll, echoErr, echoMessage, isSupportedScheme, wait } from './util/index'
import { byteIndex } from './util/string'
import { watchFiles } from './util/watch'
import Watchman from './watchman'
import uuidv1 = require('uuid/v1')
const logger = require('./util/logger')('workspace')
const CONFIG_FILE_NAME = 'coc-settings.json'
const isPkg = process.hasOwnProperty('pkg')

// global neovim settings
export interface VimSettings {
  completeOpt: string
  pluginRoot: string
  isVim: boolean
}

export class Workspace implements IWorkspace {
  public bufnr: number
  public moduleManager: ModuleManager
  public jobManager: JobManager
  public sources: Sources
  public readonly nvim: Neovim
  public readonly emitter: EventEmitter
  public configFiles: string[] = []

  private willSaveUntilHandler: WillSaveUntilHandler
  private vimSettings: VimSettings
  private _cwd = process.cwd()
  private _initialized = false
  private buffers: Map<number, Document> = new Map()
  private checking: Set<number> = new Set()
  private outputChannels: Map<string, OutputChannel> = new Map()
  private configurationShape: ConfigurationShape
  private _configurations: Configurations
  private disposables:Disposable[] = []

  private _onDidBufWinEnter = new Emitter<WinEnter>()
  private _onDidEnterDocument = new Emitter<DocumentInfo>()
  private _onDidAddDocument = new Emitter<TextDocument>()
  private _onDidCloseDocument = new Emitter<TextDocument>()
  private _onDidChangeDocument = new Emitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new Emitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new Emitter<TextDocument>()
  private _onDidChangeConfiguration = new Emitter<WorkspaceConfiguration>()
  private _onDidWorkspaceInitialized = new Emitter<void>()
  private _onDidModuleInstalled = new Emitter<string>()

  public readonly onDidEnterTextDocument: Event<DocumentInfo> = this._onDidEnterDocument.event
  public readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidAddDocument.event
  public readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidCloseDocument.event
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveDocument.event
  public readonly onDidChangeConfiguration: Event<WorkspaceConfiguration> = this._onDidChangeConfiguration.event
  public readonly onDidWorkspaceInitialized: Event<void> = this._onDidWorkspaceInitialized.event
  public readonly onDidModuleInstalled: Event<string> = this._onDidModuleInstalled.event
  public readonly onDidBufWinEnter: Event<WinEnter> = this._onDidBufWinEnter.event

  constructor() {
    let config = this.loadConfigurations()
    let configurationShape = this.configurationShape = new ConfigurationShape(this)
    this._configurations = new Configurations(config, configurationShape)
    let moduleManager = this.moduleManager = new ModuleManager()
    this.jobManager = new JobManager(this)
    this.willSaveUntilHandler = new WillSaveUntilHandler(this)
    moduleManager.on('installed', name => {
      this._onDidModuleInstalled.fire(name)
    })
    if (!global.hasOwnProperty('__TEST__')) {
      watchFiles(this.configFiles, this.onConfigurationChange.bind(this))
    }
  }

  public async init(): Promise<void> {
    this.emitter.on('BufEnter', this.onBufEnter.bind(this))
    this.emitter.on('BufWinEnter', this.onBufWinEnter.bind(this))
    this.emitter.on('DirChanged', this.onDirChanged.bind(this))
    this.emitter.on('BufCreate', this.onBufCreate.bind(this))
    this.emitter.on('BufUnload', this.onBufUnload.bind(this))
    this.emitter.on('BufWritePost', this.onBufWritePost.bind(this))
    this.emitter.on('BufWritePre', this.onBufWritePre.bind(this))
    this.emitter.on('OptionSet', this.onOptionSet.bind(this))
    this.emitter.on('FileType', this.onFileTypeChange.bind(this))
    this.emitter.on('CursorHold', this.checkBuffer.bind(this))
    this.emitter.on('TextChanged', this.checkBuffer.bind(this))
    this.emitter.on('notification', (method, args) => {
      switch (method) {
        case 'TerminalResult':
          this.moduleManager.handleTerminalResult(args[0])
          break
        case 'JobResult':
          let [id, data] = args
          this.jobManager.handleResult(id as number, data as string)
          break
      }
    })
    this.vimSettings = await this.nvim.call('coc#util#vim_info') as VimSettings
    let buffers = await this.nvim.buffers
    await Promise.all(buffers.map(buf => {
      return this.onBufCreate(buf)
    }))
    this._onDidWorkspaceInitialized.fire(void 0)
    this._initialized = true
    if (this.isVim) this.initVimEvents()
    let buffer = await this.nvim.buffer
    this.onBufEnter(buffer.id)
  }

  public get cwd(): string {
    return this._cwd
  }

  public get root(): string {
    let { cwd, bufnr } = this
    let dir: string
    if (bufnr) {
      let document = this.getDocument(bufnr)
      if (document && document.schema == 'file') dir = path.dirname(Uri.parse(document.uri).fsPath)
    }
    dir = dir || cwd
    return resolveRoot(dir, ['.vim', '.git', '.hg', '.watchmanconfig'], os.homedir()) || cwd
  }

  public get workspaceFolder(): WorkspaceFolder {
    let {root} = this
    return {
      uri: Uri.file(root).toString(),
      name: path.basename(root)
    }
  }

  public get textDocuments(): TextDocument[] {
    let docs = []
    for (let b of this.buffers.values()) {
      if (b.textDocument != null) {
        docs.push(b.textDocument)
      }
    }
    return docs
  }

  public get documents(): Document[] {
    return Array.from(this.buffers.values())
  }

  public get channelNames(): string[] {
    return Array.from(this.outputChannels.keys())
  }

  public get pluginRoot(): string {
    return isPkg ? path.resolve(process.execPath, '../..') : path.dirname(__dirname)
  }

  public get isVim(): boolean {
    return this.vimSettings.isVim
  }

  public get isNvim(): boolean {
    return !this.vimSettings.isVim
  }

  public get initialized(): boolean {
    return this._initialized
  }

  public get filetypes(): Set<string> {
    let res = new Set() as Set<string>
    for (let doc of this.documents) {
      res.add(doc.filetype)
    }
    return res
  }

  public getVimSetting<K extends keyof VimSettings>(name: K): VimSettings[K] {
    return this.vimSettings[name]
  }

  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher {
    const preferences = this.getConfiguration('coc.preferences')
    const watchmanPath = Watchman.getBinaryPath(preferences.get<string>('watchmanPath', ''))
    let promise = watchmanPath ? Watchman.createClient(watchmanPath, this.root) : Promise.resolve(null)
    return new FileSystemWatcher(
      promise,
      globPattern,
      !!ignoreCreate,
      !!ignoreChange,
      !!ignoreDelete
    )
  }

  public getConfiguration(section?: string, _resource?: string): WorkspaceConfiguration {
    return this._configurations.getConfiguration(section)
  }

  public getDocument(uri: string | number): Document
  public getDocument(bufnr: number): Document | null {
    if (typeof bufnr === 'number') {
      return this.buffers.get(bufnr)
    }
    for (let doc of this.buffers.values()) {
      if (doc && doc.uri === bufnr) return doc
    }
    return null
  }

  public async getOffset(): Promise<number> {
    let buffer = await this.nvim.buffer
    let document = this.getDocument(buffer.id)
    if (!document) return null
    let [, lnum, col] = await this.nvim.call('getcurpos')
    let line = document.getline(lnum - 1)
    if (line == null) return null
    let character = col == 1 ? 0 : byteIndex(line, col - 1)
    return document.textDocument.offsetAt({
      line: lnum - 1,
      character
    })
  }

  public async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    let { nvim } = this
    let { documentChanges, changes } = edit
    if (!this.validteDocumentChanges(documentChanges)) return false
    if (!this.validateChanges(changes)) return false
    let curpos = await nvim.call('getcurpos')
    if (documentChanges && documentChanges.length) {
      let n = 0
      for (let change of documentChanges) {
        let { textDocument, edits } = change
        let { uri } = textDocument
        let doc = this.getDocument(uri)
        if (textDocument.version == doc.version) {
          await doc.applyEdits(nvim, edits)
          n = n + 1
        } else {
          echoErr(nvim, `version mismatch of ${uri}`)
        }
      }
      echoMessage(nvim, `${n} buffers changed!`)
    }
    if (changes) {
      let keys = Object.keys(changes)
      if (!keys.length) return false
      let n = this.fileCount(edit)
      if (n > 0) {
        let c = await nvim.call('coc#util#prompt_change', [keys.length])
        if (c != 1) return false
      }
      let filetype = await nvim.buffer.getOption('filetype') as string
      for (let uri of Object.keys(changes)) {
        let edits = changes[uri]
        let filepath = Uri.parse(uri).fsPath
        let document = this.getDocument(uri)
        let doc: TextDocument
        if (document) {
          doc = document.textDocument
          await document.applyEdits(nvim, edits)
        } else {
          let stat = await statAsync(filepath)
          if (!stat || !stat.isFile()) {
            echoErr(nvim, `file ${filepath} not exists!`)
            continue
          }
          // we don't know the encoding, let vim do that
          let content = (await nvim.call('readfile', filepath)).join('\n')
          doc = TextDocument.create(uri, filetype, 0, content)
          let res = TextDocument.applyEdits(doc, edits)
          await writeFile(filepath, res)
        }
      }
    }
    await nvim.call('setpos', ['.', curpos])
    return true
  }

  public async getQuickfixItem(loc: Location): Promise<QuickfixItem> {
    let { uri, range } = loc
    let { line, character } = range.start
    let fullpath = Uri.parse(uri).fsPath
    let doc = this.getDocument(uri)
    let bufnr = doc ? doc.bufnr : 0
    let text = await this.getLine(uri, line)
    let item: QuickfixItem = {
      filename: path.relative(this.cwd, fullpath),
      lnum: line + 1,
      col: character + 1,
      text
    }
    if (bufnr) item.bufnr = bufnr
    return item
  }

  public async getLine(uri:string, line:number): Promise<string> {
    let document = this.getDocument(uri)
    if (document) return document.getline(line)
    let u = Uri.parse(uri)
    if (u.scheme === 'file') {
      let filepath = u.fsPath
      if (fs.existsSync(filepath)) {
        let lines = await this.nvim.call('readfile', u.fsPath)
        return lines[line] || ''
      }
    }
    return ''
  }

  public async readFile(uri: string): Promise<string> {
    let document = this.getDocument(uri)
    if (document) return document.content
    let u = Uri.parse(uri)
    if (u.scheme === 'file') {
      let filepath = u.fsPath
      if (fs.existsSync(filepath)) {
        let lines = await this.nvim.call('readfile', u.fsPath)
        return lines.join('\n')
      }
    }
    return ''
  }

  public onWillSaveUntil(callback: (event: TextDocumentWillSaveEvent) => void, thisArg: any, clientId: string): Disposable {
    return this.willSaveUntilHandler.addCallback(callback, thisArg, clientId)
  }

  public async refresh(): Promise<void> {
    let buffers = await this.nvim.buffers
    await Promise.all(buffers.map(buf => {
      return this.onBufCreate(buf)
    }))
    logger.info('Buffers refreshed')
  }

  public async echoLines(lines: string[]): Promise<void> {
    let { nvim } = this
    let cmdHeight = (await nvim.getOption('cmdheight') as number)
    if (lines.length > cmdHeight) {
      lines = lines.slice(0, cmdHeight)
      let last = lines[cmdHeight - 1]
      lines[cmdHeight - 1] = `${last} ...`
    }
    let cmd = lines.map(line => {
      return `echo '${line.replace(/'/g, "''")}'`
    }).join('|')
    await nvim.command(cmd)
  }

  public get document(): Promise<Document> {
    if (!this._initialized) {
      return Promise.resolve(null)
    }
    let document = this.getDocument(this.bufnr)
    if (document) return Promise.resolve(document)
    return this.nvim.buffer.then(buffer => {
      let document = this.getDocument(buffer.id)
      if (!document) return this.onBufCreate(buffer)
      return document
    })
  }

  public async getCurrentState(): Promise<EditerState> {
    let document = await this.document
    if (!document) return { document: null, position: null }
    let [, lnum, col] = await this.nvim.call('getcurpos')
    let line = document.getline(lnum - 1)
    if (!line) return { document: null, position: null }
    return {
      document: document.textDocument,
      position: {
        line: lnum - 1,
        character: byteIndex(line, col - 1)
      }
    }
  }

  public async getFormatOptions(uri?:string): Promise<FormattingOptions> {
    let doc = uri ? this.getDocument(uri) : await this.document
    if (!doc) return {tabSize: 2, insertSpaces: true}
    let { buffer } = doc
    let tabSize = await buffer.getOption('tabstop') as number
    let insertSpaces = (await buffer.getOption('expandtab')) == 1
    let options: FormattingOptions = {
      tabSize,
      insertSpaces
    }
    return options
  }

  public async jumpTo(uri: string, position: Position): Promise<void> {
    let { nvim, jumpCommand } = this
    let { line, character } = position
    let cmd = `+call\\ cursor(${line + 1},${character + 1})`
    let filepath = Uri.parse(uri).fsPath
    let bufnr = await nvim.call('bufnr', [filepath])
    if (bufnr != -1 && jumpCommand == 'edit') {
      await nvim.command(`buffer ${cmd} ${bufnr}`)
    } else {
      let cwd = await nvim.call('getcwd')
      let file = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
      await nvim.command(`exe '${jumpCommand} ${cmd} ' . fnameescape('${file}')`)
    }
  }

  public async openResource(uri: string): Promise<void> {
    let { nvim } = this
    let filepath = Uri.parse(uri).fsPath
    let bufnr = await nvim.call('bufnr', [filepath])
    if (bufnr != -1) return
    let cwd = await nvim.call('getcwd')
    let file = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
    file = file.replace(/'/g, "''")
    await nvim.command(`exe 'edit ' . fnameescape('${file}')`)
  }

  public createOutputChannel(name: string): OutputChannel {
    if (this.outputChannels.has(name)) {
      name = `${name}-${uuidv1()}`
    }
    let channel = new BufferChannel(name, this.nvim)
    this.outputChannels.set(name, channel)
    return channel
  }

  public showOutputChannel(name: string): void {
    let channel = this.outputChannels.get(name)
    if (!channel) {
      echoErr(this.nvim, `Channel "${name}" not found`)
      return
    }
    channel.show(false)
  }

  public async resolveModule(name: string, section: string, silent = false): Promise<string> {
    let res = await this.moduleManager.resolveModule(name)
    if (res) return res
    if (!silent) await this.moduleManager.installModule(name, section)
    return null
  }

  public async runCommand(cmd: string, cwd?: string): Promise<string> {
    return await this.jobManager.runCommand(cmd, cwd)
  }

  public async runTerminalCommand(cmd: string, cwd?: string): Promise<TerminalResult> {
    cwd = cwd || this.root
    return await this.moduleManager.runCommand(cmd, cwd)
  }

  public dispose(): void {
    for (let ch of this.outputChannels.values()) {
      ch.dispose()
    }
    for (let doc of this.buffers.values()) {
      doc.detach()
    }
    Watchman.dispose()
    this.moduleManager.removeAllListeners()
    disposeAll(this.disposables)
  }

  private async isBufLoaded(bufnr:number):Promise<boolean> {
    return await this.nvim.call('bufloaded', bufnr)
  }

  private async getBuffer(bufnr: number): Promise<Buffer | null> {
    let buffers = await this.nvim.buffers
    return buffers.find(buf => buf.id == bufnr)
  }

  private fileCount(edit: WorkspaceEdit): number {
    let { changes } = edit
    if (!changes) return 0
    let n = 0
    for (let uri of Object.keys(changes)) {
      let filepath = Uri.parse(uri).fsPath
      if (this.getDocument(filepath) != null) {
        n = n + 1
      }
    }
    return n
  }

  private onConfigurationChange(): void {
    let { _configurations } = this
    try {
      let config = this.loadConfigurations()
      this._configurations = new Configurations(config, this.configurationShape)
      if (!_configurations || !deepEqual(_configurations, this._configurations)) {
        this._onDidChangeConfiguration.fire(this.getConfiguration())
      }
    } catch (e) {
      logger.error(`Load configuration error: ${e.message}`)
    }
  }

  private async validteDocumentChanges(documentChanges: TextDocumentEdit[] | null): Promise<boolean> {
    if (!documentChanges) return true
    for (let change of documentChanges) {
      let { textDocument } = change
      let { uri, version } = textDocument
      let doc = this.getDocument(uri)
      if (!doc) {
        echoErr(this.nvim, `${uri} not found`)
        return false
      }
      if (doc.version != version) {
        echoErr(this.nvim, `${uri} changed before apply edit`)
        return false
      }
    }
    return true
  }

  private async validateChanges(changes: { [uri: string]: TextEdit[] }): Promise<boolean> {
    if (!changes) return true
    for (let uri of Object.keys(changes)) {
      let scheme = Uri.parse(uri).scheme
      if (!isSupportedScheme(scheme)) {
        echoErr(this.nvim, `Schema of ${uri} not supported.`)
        return false
      }
      let filepath = Uri.parse(uri).fsPath
      let stat = await statAsync(filepath)
      if (!stat || !stat.isFile()) {
        echoErr(this.nvim, `File ${filepath} not exists`)
        return false
      }
    }
  }

  private loadConfigurations(): IConfigurationData {
    let file = path.join(this.pluginRoot, 'settings.json')
    this.configFiles.push(file)
    let defaultConfig = parseContentFromFile(file)
    let home = process.env.VIMCONFIG
    if (global.hasOwnProperty('__TEST__')) {
      home = path.join(this.pluginRoot, 'src/__tests__')
    }
    file = path.join(home, CONFIG_FILE_NAME)
    this.configFiles.push(file)
    let userConfig = parseContentFromFile(file)
    file = path.join(this.root, '.vim/' + CONFIG_FILE_NAME)
    let workspaceConfig
    if (this.configFiles.indexOf(file) == -1) {
      this.configFiles.push(file)
      workspaceConfig = parseContentFromFile(file)
    } else {
      workspaceConfig = { contents: {} }
    }
    return {
      defaults: defaultConfig,
      user: userConfig,
      workspace: workspaceConfig
    }
  }

  // events for sync buffer of vim
  private initVimEvents(): void {
    let { emitter, nvim } = this
    let lastChar = ''
    let lastTs = null
    emitter.on('InsertCharPre', ch => {
      lastChar = ch
      lastTs = Date.now()
    })
    emitter.on('TextChangedI', bufnr => {
      let doc = this.getDocument(bufnr)
      if (!doc) return
      if (Date.now() - lastTs < 40 && lastChar) {
        nvim.call('coc#util#get_changeinfo', []).then(res => {
          doc.patchChange(res as ChangeInfo)
        }, () => {
          // noop
        })
      } else {
        doc.fetchContent()
      }
      lastChar = null
    })
    emitter.on('TextChanged', bufnr => {
      let doc = this.getDocument(bufnr)
      if (doc) doc.fetchContent()
    })
  }

  private get jumpCommand(): string {
    const preferences = this.getConfiguration('coc.preferences')
    return preferences.get<string>('jumpCommand', 'edit')
  }

  private onBufEnter(bufnr: number): void {
    this.bufnr = bufnr
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    let buf = doc.buffer
    let documentInfo: DocumentInfo = {
      bufnr: buf.id,
      uri: doc.uri,
      languageId: doc.filetype,
      expandtab: doc.expandtab,
      tabstop: doc.tabstop
    }
    this._onDidEnterDocument.fire(documentInfo)
  }

  private async onBufCreate(buf: number | Buffer): Promise<Document> {
    let loaded = await this.isBufLoaded(typeof buf === 'number' ? buf : buf.id)
    if (!loaded) return
    let buffer = typeof buf === 'number' ? await this.getBuffer(buf) : buf
    if (!buffer) return
    let buftype = await buffer.getOption('buftype')
    if (buftype !== '') return
    let doc = this.buffers.get(buffer.id)
    if (doc) {
      await doc.checkDocument()
      return
    }
    let document = new Document(buffer)
    await document.init(this.nvim)
    this.buffers.set(buffer.id, document)
    if (isSupportedScheme(document.schema)) {
      this._onDidAddDocument.fire(document.textDocument)
      document.onDocumentChange(({ textDocument, contentChanges }) => {
        let { version, uri } = textDocument
        this._onDidChangeDocument.fire({
          textDocument: { version, uri },
          contentChanges
        })
      })
    }
    logger.debug('buffer created', buffer.id)
    return document
  }

  private async onBufWritePost(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc || !isSupportedScheme(doc.schema)) return
    await doc.checkDocument()
    this._onDidSaveDocument.fire(doc.textDocument)
  }

  private async onBufUnload(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (doc) {
      this.buffers.delete(bufnr)
      doc.detach()
      if (isSupportedScheme(doc.schema)) {
        this._onDidCloseDocument.fire(doc.textDocument)
      }
    }
    logger.debug('buffer unload', bufnr)
  }

  private async onBufWritePre(bufnr: number): Promise<void> {
    let { nvim } = this
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    if (bufnr == this.bufnr) nvim.call('coc#util#clear', [], true)
    if (doc && isSupportedScheme(doc.schema)) {
      let event: TextDocumentWillSaveEvent = {
        document: doc.textDocument,
        reason: TextDocumentSaveReason.Manual
      }
      this._onWillSaveDocument.fire(event)
      try {
        await this.willSaveUntilHandler.handeWillSaveUntil(event)
      } catch (e) {
        logger.error(e.message)
        echoErr(nvim, e.message)
      }
    }
  }

  private onOptionSet(name:string, _oldValue:any, newValue:any): void {
    if (name === 'completeopt') {
      this.vimSettings.completeOpt = newValue
    }
  }

  private onDirChanged(cwd: string): void {
    this._cwd = cwd
    this.onConfigurationChange()
  }

  private onBufWinEnter(filepath:string, winid:number): void {
    let uri = /^\w:/.test(filepath) ? filepath : Uri.file(filepath).toString()
    let doc = this.getDocument(uri)
    this._onDidBufWinEnter.fire({
      document: doc ? doc.textDocument : null,
      winid
    })
  }

  private onFileTypeChange(filetype:string, filepath:string):void {
    let uri = Uri.file(filepath).toString()
    let doc = this.getDocument(uri)
    if (!doc) return
    let supported = isSupportedScheme(doc.schema)
    if (supported) this._onDidCloseDocument.fire(doc.textDocument)
    doc.setFiletype(filetype)
    if (supported) this._onDidAddDocument.fire(doc.textDocument)
  }

  private async checkBuffer(bufnr: number):Promise<void> {
    let doc = this.getDocument(bufnr)
    if (!doc) {
      if (this.checking.has(bufnr)) return
      this.checking.add(bufnr)
      this.emitter.emit('BufCreate', bufnr)
      let buf = await this.nvim.buffer
      if (buf.id == bufnr && bufnr != this.bufnr) {
        this.emitter.emit('BufEnter')
      }
      if (buf.id == bufnr) {
        let name = await buf.name
        let winid = await this.nvim.call('bufwinid', '%')
        this.emitter.emit('BufWinEnter', name, winid)
      }
      await wait(50)
      this.checking.delete(bufnr)
    }
  }
}

export default new Workspace()
