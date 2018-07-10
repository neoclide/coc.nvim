import { Buffer, Neovim } from 'neovim'
import { DidChangeTextDocumentParams, Emitter, Event, FormattingOptions, Location, Position, TextDocument, TextDocumentEdit, TextDocumentSaveReason, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Configurations, { parseContentFromFile } from './configurations'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import { DocumentInfo, QuickfixItem, IConfigurationData, IConfigurationModel, TextDocumentWillSaveEvent, WorkspaceConfiguration, ServiceStat } from './types'
import { getLine, resolveDirectory, resolveRoot, statAsync, writeFile } from './util/fs'
import { echoErr, echoMessage } from './util/index'
import { byteIndex } from './util/string'
import { watchFiles } from './util/watch'
import Watchman from './watchman'
import path = require('path')
const logger = require('./util/logger')('workspace')
const CONFIG_FILE_NAME = 'coc-settings.json'

function toNumber(o:any):number {
  return Number(o.toString())
}

// global neovim settings
export interface NvimSettings {
  completeOpt: string
  hasUserData: boolean
}

interface EditerState {
  document: TextDocument
  position: Position
}

export class Workspace {
  public nvim:Neovim
  // project root
  public root: string
  private buffers:{[index:number]:Document|null}
  private watchmanPromise: Promise<Watchman>
  private _configurations: Configurations
  private _onDidEnterDocument = new Emitter<DocumentInfo>()
  private _onDidAddDocument = new Emitter<TextDocument>()
  private _onDidRemoveDocument = new Emitter<TextDocument>()
  private _onDidChangeDocument = new Emitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new Emitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new Emitter<TextDocument>()
  private _onDidChangeConfiguration = new Emitter<void>()
  private _onDidWorkspaceInitialized = new Emitter<void>()

  public readonly onDidEnterTextDocument: Event<DocumentInfo> = this._onDidEnterDocument.event
  public readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidAddDocument.event
  public readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidRemoveDocument.event
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveDocument.event
  public readonly onDidChangeConfiguration: Event<void> = this._onDidChangeConfiguration.event
  public readonly onDidWorkspaceInitialized: Event<void> = this._onDidWorkspaceInitialized.event
  private watchmanPath:string
  private nvimSettings:NvimSettings
  private configFiles:string[]

  constructor() {
    this.buffers = {}
    this.configFiles = []
  }

  public async init():Promise<void> {
    let config = await this.loadConfigurations()
    this._configurations = new Configurations(config)
    this.root = await this.findProjectRoot()
    const buffers = await this.nvim.buffers
    Promise.all(buffers.map(buf => {
      return this.onBufferCreate(buf)
    })).catch(error => {
      logger.error(`buffer create error: ${error.message}`)
    })
    let buf = await this.nvim.buffer
    await this.bufferEnter(toNumber(buf.data))
    let watchmanPath = this.getConfiguration('coc.preferences').get('watchmanPath', '') as string
    this.watchmanPath = Watchman.getBinaryPath(watchmanPath)
    this.nvimSettings = {
      completeOpt: await this.nvim.getOption('completeopt') as string,
      hasUserData: await this.nvim.call('has', ['nvim-0.2.3']) == 1,
    }
    watchFiles(this.configFiles, async () => {
      let config = await this.loadConfigurations()
      this._configurations = new Configurations(config)
      this._onDidChangeConfiguration.fire(void 0)
    })
    this._onDidWorkspaceInitialized.fire(void 0)
  }

  public onOptionChange(name, newValue):void {
    if (name === 'completeopt') {
      this.nvimSettings.completeOpt = newValue
    }
  }

  public get filetypes():Set<string> {
    let res = new Set() as Set<string>
    for (let doc of this.documents) {
      res.add(doc.filetype)
    }
    return res
  }

  public getNvimSetting<K extends keyof NvimSettings>(name:K):NvimSettings[K] {
    return this.nvimSettings[name]
  }

  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher | null {
    if (!this.watchmanPath) return null
    let watchmanPromise = this.watchmanPromise || Watchman.createClient(this.watchmanPath, this.root, this.nvim)
    return new FileSystemWatcher(
      watchmanPromise,
      globPattern,
      !!ignoreCreate,
      !!ignoreChange,
      !!ignoreDelete
    )
  }

  private async findProjectRoot():Promise<string> {
    let cwd = await this.nvim.call('getcwd')
    let root = resolveRoot(cwd, ['.vim', '.git', '.hg', 'package.json'], process.env.HOME)
    return root ? root : cwd
  }

  public async findDirectory(sub:string):Promise<string> {
    // use filepath if possible
    let filepath = await this.nvim.call('coc#util#get_fullpath', ['%'])
    let dir = filepath ? path.dirname(filepath) : await this.nvim.call('getcwd')
    let res = resolveDirectory(dir, sub)
    return res ? path.dirname(res) : dir
  }

  public async saveAll(force = false):Promise<void> {
    await this.nvim.command(`wa${force ? '!' : ''}`)
  }

  public getConfiguration(section?:string, _resource?:Uri):WorkspaceConfiguration {
    return this._configurations.getConfiguration(section)
  }

  public getDocument(uri:string|number):Document
  public getDocument(bufnr:number):Document | null {
    if (typeof bufnr === 'number') {
      return this.buffers[bufnr]
    }
    for (let key of Object.keys(this.buffers)) {
      let doc = this.buffers[key]
      if (doc && doc.uri === bufnr) return doc
    }
    return null
  }

  public async getOffset():Promise<number> {
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

  private async validteDocumentChanges(documentChanges: TextDocumentEdit[] | null):Promise<boolean> {
    if (!documentChanges) return true
    for (let change of documentChanges) {
      let {textDocument} = change
      let {uri, version} = textDocument
      let doc = this.getDocument(uri)
      if (!doc) {
        await echoErr(this.nvim, `${uri} not found`)
        return false
      }
      if (doc.version != version) {
        await echoErr(this.nvim, `${uri} changed before apply edit`)
        return false
      }
    }
    return true
  }

  private async validateChanges(changes: {[uri: string]: TextEdit[]}):Promise<boolean> {
    if (!changes) return true
    for (let uri of Object.keys(changes)) {
      if (!uri.startsWith('file://')) {
        await echoErr(this.nvim, `Invalid schema for ${uri}`)
        return false
      }
      let filepath = Uri.parse(uri).fsPath
      let stat = await statAsync(filepath)
      if (!stat && stat.isFile()) {
        await echoErr(this.nvim, `File ${filepath} not exists`)
        return false
      }
    }
  }

  public async applyEdit(edit: WorkspaceEdit):Promise<boolean> {
    let {nvim} = this
    let {documentChanges, changes} = edit
    if (!this.validteDocumentChanges(documentChanges)) return false
    if (!this.validateChanges(changes)) return false
    let curpos = await nvim.call('getcurpos')
    if (documentChanges && documentChanges.length) {
      let n = 0
      for (let change of documentChanges) {
        let {textDocument, edits} = change
        let {uri} = textDocument
        let doc = this.getDocument(uri)
        if (textDocument.version == doc.version) {
          await doc.applyEdits(nvim, edits)
          n = n + 1
        } else {
          await echoErr(nvim, `version mismatch of ${uri}`)
        }
      }
      await echoMessage(nvim, `${n} buffers changed!`)
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
        let doc:TextDocument
        if (document) {
          doc = document.textDocument
          await document.applyEdits(nvim, edits)
        } else {
          let stat = await statAsync(filepath)
          if (!stat || !stat.isFile()) {
            await echoErr(nvim, `file ${filepath} not exists!`)
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

  private async isValidBuffer(buffer: Buffer):Promise<boolean> {
    let buftype = await buffer.getOption('buftype')
    return buftype == ''
  }

  public async onBufferCreate(buf: number|Buffer):Promise<Document> {
    const buffer = typeof buf === 'number' ? await this.getBuffer(buf) : buf
    const valid = await this.isValidBuffer(buffer)
    if (!valid) return
    const {buffers} = this
    const bufnr = buffer.id
    const doc = buffers[bufnr]
    if (doc) {
      await doc.checkDocument()
      return
    }
    let document = buffers[bufnr] = new Document(buffer)
    await document.init(this.nvim)
    this._onDidAddDocument.fire(document.textDocument)
    document.onDocumentChange(({textDocument, contentChanges}) => {
      let {version, uri} = textDocument
      this._onDidChangeDocument.fire({
        textDocument: {version, uri},
        contentChanges
      })
      logger.trace('buffer change', bufnr, version)
    })
    logger.debug('buffer created', bufnr)
    return document
  }

  public async getQuickfixItem(loc: Location):Promise<QuickfixItem> {
    let {uri, range} = loc
    let {line, character} = range.start
    let text:string
    let fullpath = Uri.parse(uri).fsPath
    let bufnr = await this.nvim.call('bufnr', fullpath)
    if (bufnr !== -1) {
      let document = this.getDocument(bufnr)
      if (document) text = document.getline(line)
    }
    if (text == null) {
      text = await getLine(fullpath, line)
    }
    let item:QuickfixItem = {
      filename: fullpath,
      lnum: line + 1,
      col: character + 1,
      text
    }
    if (bufnr !== -1) item.bufnr = bufnr
    return item
  }

  public async onBufferUnload(bufnr:number):Promise<void> {
    let doc = this.buffers[bufnr]
    if (doc) {
      doc.detach()
      this._onDidRemoveDocument.fire(doc.textDocument)
    }
    this.buffers[bufnr] = null
    logger.debug('bufnr unload', bufnr)
  }

  public async bufferEnter(bufnr:number):Promise<void> {
    let documentInfo = await this.nvim.call('coc#util#get_bufinfo', [bufnr])
    if (!documentInfo.languageId) return
    let uri = Uri.file(documentInfo.fullpath).toString()
    delete documentInfo.fullpath
    documentInfo.uri = uri
    this._onDidEnterDocument.fire(documentInfo as DocumentInfo)
  }

  public async onBufferWillSave(bufnr:number):Promise<void> {
    let {nvim} = this
    let doc = this.buffers[bufnr]
    let called = false
    let waitUntil
    let promise = new Promise((resolve, reject):void => { // tslint:disable-line
      waitUntil = (thenable: Thenable<TextEdit[]|any>):void => {
        if (called) {
          echoErr(nvim, 'WaitUntil could only be called once').catch(_e => {
            // noop
          })
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
        echoErr(nvim, e.message).catch(_e => {
          // noop
        })
      }
    }
  }

  public async onBufferDidSave(bufnr:number):Promise<void> {
    let doc = this.buffers[bufnr]
    if (doc) {
      await doc.checkDocument()
      this._onDidSaveDocument.fire(doc.textDocument)
    }
  }

  // all exists documents
  public get textDocuments():TextDocument[] {
    let docs = Object.keys(this.buffers).map(key => {
      return this.buffers[key]
    })
    docs = docs.filter(d => d != null)
    return docs.map(d => d.textDocument)
  }

  public get documents():Document[] {
    let docs = Object.keys(this.buffers).map(key => {
      return this.buffers[key]
    })
    return docs.filter(d => d != null)
  }

  public async refresh():Promise<void> {
    let buffers = await this.nvim.buffers
    await Promise.all(buffers.map(buf => {
      return this.onBufferCreate(buf)
    }))
    logger.info('Buffers refreshed')
  }

  public async echoLines(lines:string[]):Promise<void> {
    let {nvim} = this
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

  public get document():Promise<Document> {
    return this.nvim.buffer.then(buffer => {
      let document = this.getDocument(buffer.id)
      if (!document) return this.onBufferCreate(buffer)
      return document
    })
  }

  public async getCurrentState():Promise<EditerState> {
    let document = await this.document
    if (!document) return {document: null, position: null}
    let [, lnum, col] = await this.nvim.call('getcurpos')
    let line = document.getline(lnum - 1)
    if (!line) return {document: null, position: null}
    return {
      document: document.textDocument,
      position: {
        line: lnum - 1,
        character: byteIndex(line, col - 1)
      }
    }
  }

  public async getFormatOptions():Promise<FormattingOptions> {
    let buffer = await this.nvim.buffer
    let tabSize = await buffer.getOption('tabstop') as number
    let insertSpaces = (await buffer.getOption('expandtab')) == 1
    let options:FormattingOptions = {
      tabSize,
      insertSpaces
    }
    return options
  }

  public async jumpTo(uri:string, position:Position):Promise<void> {
    let {nvim} = this
    let {line, character} = position
    let cmd = `+call\\ cursor(${line + 1},${character + 1})`
    let filepath = Uri.parse(uri).fsPath
    let bufnr = await nvim.call('bufnr', [filepath])
    await nvim.command("execute 'normal! m'''")
    if (bufnr != -1) {
      await nvim.command(`buffer ${cmd} ${bufnr}`)
    } else {
      let cwd = await nvim.call('getcwd')
      let file = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
      await nvim.command(`exe 'edit ${cmd} ' . fnameescape('${file}')`)
    }
  }

  public async openResource(uri:string):Promise<void> {
    let {nvim} = this
    let filepath = Uri.parse(uri).fsPath
    let bufnr = await nvim.call('bufnr', [filepath])
    if (bufnr != -1) return
    let cwd = await nvim.call('getcwd')
    let file = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
    await nvim.command(`exe 'edit ' . fnameescape('${file}')`)
  }

  private async parseConfigFile(file):Promise<IConfigurationModel> {
    let config
    try {
      config = await parseContentFromFile(file)
    } catch (e) {
      await echoErr(this.nvim, `parseFile ${file} error: ${e.message}`)
      config = {contents: {}}
    }
    return config
  }

  private async loadConfigurations():Promise<IConfigurationData> {
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
      projectConfig = {contents: {}}
    }
    return {
      defaults: defaultConfig,
      user: userConfig,
      folder: projectConfig
    }
  }

  private async getBuffer(bufnr:number):Promise<Buffer|null> {
    let buffers = await this.nvim.buffers
    return buffers.find(buf => toNumber(buf.data) == bufnr)
  }

  private fileCount(edit: WorkspaceEdit):number {
    let {changes} = edit
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
}

export default new Workspace()
