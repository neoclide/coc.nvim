import {Neovim, Buffer} from 'neovim'
import Document from './model/document'
import {
  readFile,
  writeFile,
  statAsync,
  resolveDirectory,
  resolveRoot,
} from './util/fs'
import {
  FormatOptions,
  IConfigurationData,
  IConfigurationModel,
  WorkspaceConfiguration,
} from './types'
import {
  echoErr,
  echoWarning,
  EventEmitter,
  Event,
  Uri,
  getChangeEvent,
} from './util/index'
import Configurations, { parseContentFromFile } from './configurations'
import {
  TextDocument,
  DidChangeTextDocumentParams,
  TextDocumentWillSaveEvent,
  TextDocumentSaveReason,
  WorkspaceEdit,
} from 'vscode-languageserver-protocol'
import FileSystemWatcher from './model/fileSystemWatcher'
import path = require('path')
const logger = require('./util/logger')('workspace')
const CONFIG_FILE_NAME = 'coc-settings.json'

function toNumber(o:any):number {
  return Number(o.toString())
}

export class Workspace {
  public nvim:Neovim
  public buffers:{[index:number]:Document}

  private _configurations: Configurations
  // project root

  public  root: string
  private _onDidAddDocument = new EventEmitter<TextDocument>()
  private _onDidRemoveDocument = new EventEmitter<TextDocument>()
  private _onDidChangeDocument = new EventEmitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new EventEmitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new EventEmitter<TextDocument>()

  private readonly onDidAddDocument: Event<TextDocument> = this._onDidAddDocument.event
  private readonly onDidRemoveDocument: Event<TextDocument> = this._onDidRemoveDocument.event
  private readonly onDidChangeDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  private readonly onWillSaveDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  private readonly onDidSaveDocument: Event<TextDocument> = this._onDidSaveDocument.event

  constructor() {
    this.buffers = {}
  }

  public async init():Promise<void> {
    let config = await this.loadConfigurations()
    this._configurations = new Configurations(config)
    this.root = await this.findProjectRoot()
  }

  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher {
    return new FileSystemWatcher(
      this.root,
      globPattern,
      !!ignoreCreate,
      !!ignoreChange,
      !!ignoreDelete
    )
  }

  private async findProjectRoot():Promise<string> {
    let cwd = await this.nvim.call('getcwd')
    return resolveRoot(cwd, ['.vim', '.git', '.hg'], process.env.HOME)
  }

  public async saveAll(force = false):Promise<void> {
    await this.nvim.command(`wa${force ? '!' : ''}`)
  }

  public getConfiguration(section:string):WorkspaceConfiguration {
    return this._configurations.getConfiguration(section)
  }

  public getDocument(bufnr:number):Document | null {
    return this.buffers[bufnr]
  }

  public getDocumentFromUri(uri:string):Document | null {
    for (let key of Object.keys(this.buffers)) {
      let doc = this.buffers[key]
      if (doc.uri === uri) return doc
    }
    return null
  }

  public async getFormatOptions():Promise<FormatOptions> {
    let {nvim} = this
    let buffer = await nvim.buffer
    let tabSize = await buffer.getOption('tabstop')
    let insertSpaces = await buffer.getOption('expandtab')
    return {
      tabSize: Number(tabSize),
      insertSpaces: insertSpaces == '1'
    }
  }

  public async applyEdit(edit: WorkspaceEdit):Promise<void> {
    let {nvim} = this
    let {documentChanges, changes} = edit
    if (documentChanges && documentChanges.length) {
      for (let change of documentChanges) {
        let {textDocument, edits} = change
        let { uri, version } = textDocument
        let doc = this.getDocumentFromUri(uri)
        if (!doc) {
          await echoWarning(nvim, `${uri} not found`)
          continue
        }
        if (doc.version != version) {
          await echoWarning(nvim, `${uri} changed before apply edit`)
          continue
        }
        await doc.applyEdits(nvim, edits)
      }
    } else if (changes) {
      let keys = Object.keys(changes)
      keys = keys.filter(key => key.startsWith('file://'))
      if (!keys.length) return
      let arr = []
      for (let key of keys) {
        let doc = this.getDocumentFromUri(key)
        if (doc) {
          await doc.applyEdits(nvim, changes[key])
        } else {
          let uri = Uri.parse(key)
          arr.push({
            fullpath: uri.fsPath,
            edits: changes[key]
          })
        }
      }
      if (arr.length) {
        let c = await nvim.call('coc#prompt_change', [arr.length])
        let buf = await nvim.buffer
        let filetype = await buf.getOption('filetype')
        if (c == 1) {
          for (let item of arr) {
            let {fullpath, edits} = item
            let doc = await this.createDocument(fullpath, filetype as string)
            let content = TextDocument.applyEdits(doc, edits)
            await writeFile(fullpath, content)
          }
        }
      }
    }
  }

  public async addBuffer(bufnr:number):Promise<void> {
    let buffer = await this.getBuffer(bufnr)
    if (!buffer) return
    let {buffers} = this
    try {
      let buftype = await buffer.getOption('buftype')
      // only care normal buffer
      if (buftype !== '') return
      let origDoc = buffers[bufnr] ? buffers[bufnr] : null
      let version = await buffer.changedtick
      // not changed
      if (origDoc && origDoc.version == version) {
        return
      }
      let {uri, filetype, keywordOption} = origDoc || {} as any
      if (!origDoc) {
        let name = await buffer.name
        uri = this.getUri(name, bufnr)
        filetype = (await buffer.getOption('filetype') as string)
        keywordOption = (await buffer.getOption('iskeyword') as string)
      }
      let lines = await buffer.lines
      let content = lines.join('\n')
      let textDocument = TextDocument.create(uri, filetype, version, content)
      if (!origDoc) {
        buffers[bufnr] = new Document(bufnr, textDocument, keywordOption)
        this._onDidAddDocument.fire(textDocument)
      } else {
        origDoc.changeDocument(textDocument)
        let evt = getChangeEvent(origDoc.textDocument, content)
        this._onDidChangeDocument.fire({
          textDocument,
          contentChanges: [evt]
        })
      }
    } catch (e) {
      logger.error(`buffer add error ${e.message}`)
    }
    return null
  }

  public async removeBuffer(bufnr:number):Promise<void> {
    let doc = this.buffers[bufnr]
    this.buffers[bufnr] = null
    if (doc) this._onDidRemoveDocument.fire(doc.textDocument)
  }

  public async bufferWillSave(bufnr:number):Promise<void> {
    let doc = this.buffers[bufnr]
    if (doc) {
      this._onWillSaveDocument.fire({
        document: doc.textDocument,
        reason: TextDocumentSaveReason.Manual
      })
    }
  }

  public async bufferDidSave(bufnr:number):Promise<void> {
    let doc = this.buffers[bufnr]
    if (doc) {
      this._onDidSaveDocument.fire(doc.textDocument)
    }
  }

  // all exists documents
  public get textDocuments():TextDocument[] {
    return Object.keys(this.buffers).map(key => {
      return this.buffers[key].textDocument
    })
  }

  public async refresh():Promise<void> {
    let bufs:number[] = await this.nvim.call('coc#util#get_buflist', [])
    this.buffers = []
    for (let buf of bufs) {
      await this.addBuffer(buf)
    }
    logger.info('Buffers refreshed')
  }

  // words exclude bufnr and ignored files
  public getWords(bufnr: number):string[] {
    let words: string[] = []
    for (let nr of Object.keys(this.buffers)) {
      if (bufnr == Number(nr)) continue
      let document = this.buffers[nr]
      if (document.isIgnored) continue
      for (let word of document.words) {
        if (words.indexOf(word) == -1) {
          words.push(word)
        }
      }
    }
    return words
  }

  public async createDocument(fullpath:string, filetype:string):Promise<TextDocument|null> {
    let {textDocuments} = this
    let uri = Uri.file(fullpath)
    let document = textDocuments.find(o => o.uri == uri.toString())
    if (document) return document
    let exists = await statAsync(fullpath)
    if (!exists) {
      await echoErr(this.nvim, `File ${fullpath} not exists.`)
      return null
    }
    let content = await readFile(uri.fsPath, 'utf8')
    return TextDocument.create(uri.toString(), filetype, 0, content)
  }

  public async openTextDocument(uri:Uri):Promise<void> {
    await this.nvim.command(`edit ${uri.fsPath}`)
  }

  public onDidOpenTextDocument(listener, thisArgs?, disposables?):void {
    this.onDidAddDocument(listener, thisArgs, disposables)
  }

  public onDidCloseTextDocument(listener, thisArgs?, disposables?):void {
    this.onDidRemoveDocument(listener, thisArgs, disposables)
  }

  public onDidChangeTextDocument(listener, thisArgs?, disposables?):void {
    this.onDidChangeDocument(listener, thisArgs, disposables)
  }

  public onWillSaveTextDocument(listener, thisArgs?, disposables?):void {
    this.onWillSaveDocument(listener, thisArgs, disposables)
  }

  public onDidSaveTextDocument(listener, thisArgs?, disposables?):void {
    this.onDidSaveDocument(listener, thisArgs, disposables)
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
    let file = path.resolve(__dirname, '../settings/default.json')
    let defaultConfig = await this.parseConfigFile(file)
    let userHome = await this.nvim.call('coc#util#get_home')
    let userConfig = await this.parseConfigFile(path.join(userHome, CONFIG_FILE_NAME))
    let cwd = await this.nvim.call('getcwd')
    let dir = resolveDirectory(cwd, '.vim')
    let projectConfig = dir ? await this.parseConfigFile(path.join(dir, CONFIG_FILE_NAME)) : {contents: {}}
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

  private getUri(fullpath:string, bufnr:number):string {
    if (!fullpath) return `untitled://${bufnr}`
    if (/^\w+:\/\//.test(fullpath)) return fullpath
    return `file://${fullpath}`
  }

  // public onDidChangeConfiguration(listener, thisArgs?, disposables?):void {
  //   this.onChangeConfiguration(listener, thisArgs, disposables)
  // }
}

export default new Workspace()
