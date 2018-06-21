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
  IWorkSpace,
  IConfigurationData,
  IConfigurationModel,
  WorkspaceConfiguration,
  DocumentInfo,
} from './types'
import {
  echoErr,
  echoWarning,
  EventEmitter,
  Event,
  Uri,
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

export class Workspace implements IWorkSpace {
  public nvim:Neovim
  // project root
  public root: string
  private buffers:{[index:number]:Document|null}
  private watchmanPromise: Promise<Watchman>
  private _configurations: Configurations
  private _onDidEnterDocument = new EventEmitter<DocumentInfo>()
  private _onDidAddDocument = new EventEmitter<TextDocument>()
  private _onDidRemoveDocument = new EventEmitter<TextDocument>()
  private _onDidChangeDocument = new EventEmitter<DidChangeTextDocumentParams>()
  private _onWillSaveDocument = new EventEmitter<TextDocumentWillSaveEvent>()
  private _onDidSaveDocument = new EventEmitter<TextDocument>()

  public readonly onDidEnterTextDocument: Event<DocumentInfo> = this._onDidEnterDocument.event
  public readonly onDidOpenTextDocument: Event<TextDocument> = this._onDidAddDocument.event
  public readonly onDidCloseTextDocument: Event<TextDocument> = this._onDidRemoveDocument.event
  public readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams> = this._onDidChangeDocument.event
  public readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent> = this._onWillSaveDocument.event
  public readonly onDidSaveTextDocument: Event<TextDocument> = this._onDidSaveDocument.event
  private watchmanPath:string
  private nvimSettings:NvimSettings

  constructor() {
    this.buffers = {}
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
  }

  public getNvimSetting<K extends keyof NvimSettings>(name:K):NvimSettings[K] {
    return this.nvimSettings[name]
  }

  public createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher | null {
    if (!this.watchmanPath) return null
    let watchmanPromise = this.watchmanPromise || Watchman.createClient(this.watchmanPath, this.root)
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

  public getConfiguration(section:string):WorkspaceConfiguration {
    return this._configurations.getConfiguration(section)
  }

  public getDocument(bufnr:number):Document | null {
    return this.buffers[bufnr]
  }

  public getDocumentFromUri(uri:string):Document | null {
    for (let key of Object.keys(this.buffers)) {
      let doc = this.buffers[key]
      if (doc && doc.uri === uri) return doc
    }
    return null
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
            uri,
            edits: changes[key]
          })
        }
      }
      if (arr.length) {
        let c = await nvim.call('coc#util#prompt_change', [arr.length])
        let buf = await nvim.buffer
        let filetype = await buf.getOption('filetype')
        if (c == 1) {
          for (let item of arr) {
            let {uri, edits} = item
            let doc = await this.createDocument(uri.toString(), filetype as string)
            let content = TextDocument.applyEdits(doc, edits)
            await writeFile(uri.fsPath, content)
          }
        }
      }
    }
  }

  private async isValidBuffer(buffer: Buffer):Promise<boolean> {
    let buftype = await buffer.getOption('buftype')
    return buftype == ''
  }

  public async onBufferCreate(buf: number|Buffer):Promise<void> {
    const buffer = typeof buf === 'number' ? await this.getBuffer(buf) : buf
    const valid = await this.isValidBuffer(buffer)
    if (!valid) return
    const {buffers} = this
    const bufnr = buffer.id
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
    logger.trace('buffer created', bufnr)
  }

  public async onBufferUnload(bufnr:number):Promise<void> {
    let doc = this.buffers[bufnr]
    this.buffers[bufnr] = null
    if (doc) {
      this._onDidRemoveDocument.fire(doc.textDocument)
      doc.detach()
    }
    logger.trace('bufnr unload', bufnr)
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
    let doc = this.buffers[bufnr]
    if (doc) {
      this._onWillSaveDocument.fire({
        document: doc.textDocument,
        reason: TextDocumentSaveReason.Manual
      })
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

  /**
   * Find or create a TextDocument from uri and languageId
   *
   * @public
   * @param {string} uri
   * @param {string} languageId?
   * @returns {Promise<TextDocument|null>}
   */
  public async createDocument(uri:string, languageId?:string):Promise<TextDocument|null> {
    // may be we could support other uri schema
    let {textDocuments} = this
    let fullpath = Uri.parse(uri).fsPath
    let document = textDocuments.find(o => o.uri == uri)
    if (document) return document
    if (!languageId) languageId = (await this.nvim.eval('&filetype') as string)
    let exists = await statAsync(fullpath)
    if (!exists) {
      await echoErr(this.nvim, `File ${fullpath} not exists.`)
      return null
    }
    let content = await readFile(fullpath, 'utf8')
    return TextDocument.create(uri, languageId, 0, content)
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
    let userHome = await this.nvim.call('coc#util#get_config_home')
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
}

export default new Workspace()
