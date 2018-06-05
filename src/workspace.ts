import {Neovim, Buffer} from 'neovim'
import Document from './model/document'
import {
  readFile,
  statAsync
} from './util/fs'
import {
  echoErr
} from './util/index'
import {
  EventEmitter,
  Event
} from './vscode'
import {
  TextDocument,
  TextDocumentContentChangeEvent,
  DidChangeTextDocumentParams,
  TextDocumentWillSaveEvent,
  TextDocumentSaveReason,
} from 'vscode-languageserver-protocol'
const logger = require('./util/logger')('workspace')
// TODO import buffers here

function toNumber(o:any):number {
  return Number(o.toString())
}

function getChangeEvent(doc:TextDocument, text):TextDocumentContentChangeEvent {
  let orig = doc.getText()
  if (!orig.length) return {text}
  let start = -1
  let end = orig.length
  let changedText = ''
  for (let i = 0, l = orig.length; i < l; i++) {
    if (orig[i] !== text[i]) {
      start = i
      break
    }
  }
  if (start != -1) {
    let cl = text.length
    let n = 1
    for (let i = end - 1; i >= 0; i--) {
      let j = cl - n
      if (orig[i] !== text[j]) {
        end = i + 1
        changedText = text.slice(start, j + 1)
        break
      }
      n++
    }
  } else {
    changedText = text.slice(end)
  }
  return {
    range: {
      start: doc.positionAt(start),
      end: doc.positionAt(end),
    },
    rangeLength: end - start,
    text: changedText
  }
}

export class Workspace {
  public nvim:Neovim
  public buffers:{[index:number]:Document}

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

  public getDocument(bufnr:number):Document | null {
    return this.buffers[bufnr]
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
        buffers[bufnr] = new Document(textDocument, keywordOption)
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
    let uri = `file://${fullpath}`
    let document = textDocuments.find(o => o.uri == uri)
    if (document) return document
    let exists = await statAsync(fullpath)
    if (!exists) {
      await echoErr(this.nvim, `File ${fullpath} not exists.`)
      return null
    }
    let content = await readFile(uri.replace('file://', ''), 'utf8')
    return TextDocument.create(uri, filetype, 0, content)
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
}

export default new Workspace()
