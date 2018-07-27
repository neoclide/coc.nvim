import { Buffer, Neovim } from '@chemzqm/neovim'
import { DidChangeTextDocumentParams, Emitter, Event, FormattingOptions, Location, Position, TextDocument, TextDocumentEdit, TextDocumentSaveReason, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Configurations, { parseContentFromFile } from './configurations'
import Document from './model/document'
import ModuleManager from './model/moduleManager'
import JobManager from './model/jobManager'
import FileSystemWatcher from './model/fileSystemWatcher'
import BufferChannel from './model/outputChannel'
import { ChangeInfo, DocumentInfo, IConfigurationData, IConfigurationModel, QuickfixItem, TextDocumentWillSaveEvent, WorkspaceConfiguration, OutputChannel } from './types'
import { getLine, resolveDirectory, resolveRoot, statAsync, writeFile } from './util/fs'
import ConfigurationShape from './model/configurationShape'
import { echoErr, echoMessage } from './util/index'
import { byteIndex } from './util/string'
import { watchFiles } from './util/watch'
import Watchman from './watchman'
import path from 'path'
import uuidv1 = require('uuid/v1')
import { EventEmitter } from 'events'
const logger = require('./util/logger')('workspace')
const CONFIG_FILE_NAME = 'coc-settings.json'

// global neovim settings
export interface VimSettings {
  completeOpt: string
  isVim: boolean
}

interface EditerState {
  document: TextDocument
  position: Position
}

export class Workspace {
  public nvim: Neovim
  // project root
  public root: string
  public bufnr: number
  private _initialized = false
  private buffers: Map<number, Document> = new Map()
  private outputChannels: Map<string, OutputChannel> = new Map()
  private watchmanPromise: Promise<Watchman>
  private configurationShape: ConfigurationShape
  private _configurations: Configurations
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
  public emitter: EventEmitter
  private moduleManager: ModuleManager
  private watchmanPath: string
  private vimSettings: VimSettings
  private configFiles: string[]
  private jumpCommand: string
  private jobManager: JobManager

  constructor() {
    this.configFiles = []
  }

  public async init(): Promise<void> {
    let moduleManager = this.moduleManager = new ModuleManager()
    this.jobManager = new JobManager(this.nvim, this.emitter)
    moduleManager.on('installed', name => {
      this._onDidModuleInstalled.fire(name)
    })
    let config = await this.loadConfigurations()
    let { configFiles } = this
    let configurationShape = this.configurationShape = new ConfigurationShape(this.nvim, configFiles[1], configFiles[2])
    this._configurations = new Configurations(config, configurationShape)
    this.root = await this.findProjectRoot()
    let buffers = await this.nvim.buffers
    await Promise.all(buffers.map(buf => {
      return this.onBufferCreate(buf)
    })).catch(error => {
      logger.error(`buffer create error: ${error.message}`)
    })
    const preferences = this.getConfiguration('coc.preferences')
    const watchmanPath = preferences.get<string>('watchmanPath', '')
    this.jumpCommand = preferences.get<string>('jumpCommand', 'edit')
    this.watchmanPath = Watchman.getBinaryPath(watchmanPath)
    this.vimSettings = await this.nvim.call('coc#util#vim_info') as VimSettings
    watchFiles(this.configFiles, this.onConfigurationChange.bind(this))
    this._onDidWorkspaceInitialized.fire(void 0)
    this._initialized = true
    if (this.isVim) {
      this.initVimEvents()
    }
  }

  public get isVim(): boolean {
    return this.vimSettings.isVim
  }

  public get initialized(): boolean {
    return this._initialized
  }

  public onOptionChange(name, newValue): void {
    if (name === 'completeopt') {
      this.vimSettings.completeOpt = newValue
    }
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

  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher | null {
    let promise = this.watchmanPromise
    if (this.watchmanPath && !this.watchmanPromise) {
      let channel = this.createOutputChannel('watchman')
      promise = this.watchmanPromise = Watchman.createClient(this.watchmanPath, this.root, channel)
    }
    return new FileSystemWatcher(
      promise,
      globPattern,
      !!ignoreCreate,
      !!ignoreChange,
      !!ignoreDelete
    )
  }

  public async findDirectory(sub: string): Promise<string> {
    // use filepath if possible
    let filepath = await this.nvim.call('coc#util#get_fullpath', ['%'])
    let dir = filepath ? path.dirname(filepath) : await this.nvim.call('getcwd')
    let res = resolveDirectory(dir, sub)
    return res ? path.dirname(res) : dir
  }

  public async saveAll(force = false): Promise<void> {
    await this.nvim.command(`wa${force ? '!' : ''}`)
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

  public async onBufferCreate(buf: number | Buffer): Promise<Document> {
    const buffer = typeof buf === 'number' ? await this.getBuffer(buf) : buf
    if (!buffer) return
    const valid = await this.isValidBuffer(buffer)
    if (!valid) return
    const doc = this.buffers.get(buffer.id)
    if (doc) {
      await doc.checkDocument()
      return
    }
    let document = new Document(buffer)
    this.buffers.set(buffer.id, document)
    await document.init(this.nvim)
    this._onDidAddDocument.fire(document.textDocument)
    document.onDocumentChange(({ textDocument, contentChanges }) => {
      let { version, uri } = textDocument
      this._onDidChangeDocument.fire({
        textDocument: { version, uri },
        contentChanges
      })
    })
    logger.debug('buffer created', buffer.id)
    return document
  }

  public async getQuickfixItem(loc: Location): Promise<QuickfixItem> {
    let { uri, range } = loc
    let { line, character } = range.start
    let text: string
    let fullpath = Uri.parse(uri).fsPath
    let bufnr = await this.nvim.call('bufnr', fullpath)
    if (bufnr !== -1) {
      let document = this.getDocument(bufnr)
      if (document) text = document.getline(line)
    }
    if (text == null) {
      text = await getLine(fullpath, line)
    }
    let item: QuickfixItem = {
      filename: fullpath,
      lnum: line + 1,
      col: character + 1,
      text
    }
    if (bufnr !== -1) item.bufnr = bufnr
    return item
  }

  public async onBufferUnload(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (doc) {
      doc.detach()
      this._onDidCloseDocument.fire(doc.textDocument)
    }
    this.buffers.delete(bufnr)
    logger.debug('buffer unload', bufnr)
  }

  public async bufferEnter(bufnr: number): Promise<void> {
    this.bufnr = bufnr
    if (!this.buffers.get(bufnr)) return
    let documentInfo = await this.nvim.call('coc#util#get_bufinfo', [bufnr])
    if (!documentInfo.languageId) return
    let uri = Uri.file(documentInfo.fullpath).toString()
    delete documentInfo.fullpath
    documentInfo.uri = uri
    this._onDidEnterDocument.fire(documentInfo as DocumentInfo)
  }

  public async onBufferWillSave(bufnr: number): Promise<void> {
    let { nvim } = this
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    let called = false
    if (bufnr == this.bufnr) nvim.call('coc#util#clear', [], true)
    let waitUntil
    let promise = new Promise((resolve, reject): void => { // tslint:disable-line
      waitUntil = (thenable: Thenable<TextEdit[] | any>): void => {
        if (called) {
          echoErr(nvim, 'WaitUntil could only be called once')
          return
        }
        called = true
        Promise.resolve(thenable).then(res => {
          if (Array.isArray(res) && typeof res[0].newText == 'string') {
            doc.applyEdits(nvim, res as TextEdit[]).then(() => {
              resolve()
            }, reject)
          } else {
            resolve()
          }
        }, reject)
        setTimeout(() => {
          reject(new Error('WaitUntil timeout after 1 second'))
        }, 1000)
      }
    })
    if (doc) {
      this._onWillSaveDocument.fire({
        document: doc.textDocument,
        reason: TextDocumentSaveReason.Manual,
        waitUntil
      })
    }
    if (called) {
      try {
        await promise
      } catch (e) {
        logger.error(e.message)
        echoErr(nvim, e.message)
      }
    }
  }

  public async onBufferDidSave(bufnr: number): Promise<void> {
    let doc = this.buffers.get(bufnr)
    if (!doc) return
    await doc.checkDocument()
    this._onDidSaveDocument.fire(doc.textDocument)
  }

  // all exists documents
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

  public async refresh(): Promise<void> {
    let buffers = await this.nvim.buffers
    await Promise.all(buffers.map(buf => {
      return this.onBufferCreate(buf)
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
      if (!document) return this.onBufferCreate(buffer)
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

  public async getFormatOptions(): Promise<FormattingOptions> {
    let doc = await this.document
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
    if (bufnr != -1 && cmd == 'edit') {
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
    await nvim.command(`exe 'edit ' . fnameescape('${file}')`)
  }

  public async diffDocument(): Promise<void> {
    let { nvim } = this
    let buffer = await nvim.buffer
    let document = this.getDocument(buffer.id)
    if (!document) {
      echoErr(nvim, `Document of bufnr ${buffer.id} not found`)
      return
    }
    let lines = document.content.split('\n')
    await nvim.call('coc#util#diff_content', [lines])
  }

  public get channelNames(): string[] {
    return Array.from(this.outputChannels.keys())
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

  public async runCommand(cmd: string, cwd?: string):Promise<string> {
    return await this.jobManager.runCommand(cmd, cwd)
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

  private async onConfigurationChange(): Promise<void> {
    try {
      let config = await this.loadConfigurations()
      this._configurations = new Configurations(config, this.configurationShape)
      this._onDidChangeConfiguration.fire(this.getConfiguration())
    } catch (e) {
      logger.error(`Load configuration error: ${e.message}`)
    }
  }

  private async findProjectRoot(): Promise<string> {
    let cwd = await this.nvim.call('getcwd')
    let root = resolveRoot(cwd, ['.vim', '.git', '.hg'], process.env.HOME)
    return root ? root : cwd
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
      if (!uri.startsWith('file://')) {
        echoErr(this.nvim, `Invalid schema for ${uri}`)
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

  private async parseConfigFile(file): Promise<IConfigurationModel> {
    let config
    try {
      config = await parseContentFromFile(file)
    } catch (e) {
      echoErr(this.nvim, `parseFile ${file} error: ${e.message}`)
      config = { contents: {} }
    }
    return config
  }

  private async isValidBuffer(buffer: Buffer): Promise<boolean> {
    let loaded = await this.nvim.call('bufloaded', buffer.id)
    if (loaded !== 1) return false
    let buftype = await buffer.getOption('buftype')
    return buftype == ''
  }

  private async loadConfigurations(): Promise<IConfigurationData> {
    let file = path.resolve(__dirname, '../settings.json')
    this.configFiles.push(file)
    let defaultConfig = await this.parseConfigFile(file)
    let home = await this.nvim.call('coc#util#get_config_home')
    file = path.join(home, CONFIG_FILE_NAME)
    this.configFiles.push(file)
    let userConfig = await this.parseConfigFile(file)
    let cwd = await this.nvim.call('getcwd')
    let dir = resolveDirectory(cwd, '.vim')
    let projectConfig
    file = dir ? path.join(dir, CONFIG_FILE_NAME) : null
    if (this.configFiles.indexOf(file) == -1) {
      this.configFiles.push(file)
      projectConfig = await this.parseConfigFile(file)
    } else {
      projectConfig = { contents: {} }
    }
    return {
      defaults: defaultConfig,
      user: userConfig,
      workspace: projectConfig
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
}

export default new Workspace()
