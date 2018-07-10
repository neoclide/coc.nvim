import { Neovim, Buffer } from 'neovim'
import {
  BufferOption,
} from '../types'
import Uri from 'vscode-uri'
import {
  TextDocument,
  Position,
  Range,
  TextEdit,
  DidChangeTextDocumentParams,
  Emitter,
  Event,
  Disposable,
} from 'vscode-languageserver-protocol'
import {Chars} from './chars'
import {
  disposeAll,
  getUri,
} from '../util/index'
import {
  isGitIgnored,
} from '../util/fs'
import {
  getChange
} from '../util/diff'
import debounce from 'debounce'
const logger = require('../util/logger')('model-document')

// wrapper class of TextDocument
export default class Document {
  public isIgnored = false
  public chars:Chars
  public paused: boolean
  public textDocument: TextDocument
  private _fireContentChanges: Function & { clear(): void; }
  private _onDocumentChange = new Emitter<DidChangeTextDocumentParams>()
  private attached = false
  private disposables:Disposable[] = []
  // real current lines
  private lines:string[] = []
  private _changedtick:number
  private _words:string[] = []
  public readonly words:string[]
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  constructor(public buffer:Buffer) {
    this._fireContentChanges = debounce(() => {
      try {
        this.fireContentChanges()
      } catch (e) {
        logger.error('contentChanges error: ', e.stack)
      }
    }, 20)
    Object.defineProperty(this, 'words', {
      get: () => {
        return this._words
      }
    })
    let paused = false
    Object.defineProperty(this, 'paused', {
      get: () => {
        return paused
      },
      set: (val:boolean) => {
        if (val == paused) return
        if (val) {
          paused = true
        } else {
          paused = false
          // fire immediatelly
          this._fireContentChanges.clear()
          this.fireContentChanges()
        }
      }
    })
  }

  private generateWords():void {
    let {content} = this
    this._words = this.chars.matchKeywords(content)
  }

  /**
   * Current changedtick of buffer
   *
   * @public
   * @returns {number}
   */
  public get changedtick():number {
    return this._changedtick
  }

  public async init(nvim:Neovim):Promise<void> {
    let {buffer} = this
    let opts = await nvim.call('coc#util#get_bufoptions', [buffer.id]) as BufferOption
    let {fullpath, filetype, iskeyword} = opts
    let uri = getUri(fullpath, buffer.id)
    let chars = this.chars = new Chars(iskeyword)
    if (this.includeDash(filetype)) chars.addKeyword('-')
    this.lines = await buffer.lines as string[]
    this._changedtick = await buffer.changedtick
    this.textDocument = TextDocument.create(uri, filetype, 0, this.lines.join('\n'))
    this.attach()
    this.attached = true
    this.generateWords()
    this.gitCheck().catch(e => {
      logger.error('git error', e.stack)
    })
  }

  public get lineCount():number {
    return this.lines.length
  }

  /**
   * Real current line
   *
   * @public
   * @param {number} line - zero based line number
   * @returns {string}
   */
  public getline(line:number):string {
    if (line < 0) return null
    return this.lines[line]
  }

  public attach():void {
    let unbindLines = this.buffer.listen('lines', (...args) => {
      try {
        this.onChange.apply(this, args)
      } catch(e) {
        logger.error(e.stack)
      }
    })
    let unbindDetach = this.buffer.listen('detach', () => {
      logger.debug('buffer detach')
    })
    let unbindChange = this.buffer.listen('changedtick', (buf:Buffer, tick:number) => {
      if (buf.id !== this.buffer.id) return
      this._changedtick = tick
    })
    this.disposables.push({
      dispose: () => {
        unbindDetach()
        unbindLines()
        unbindChange()
      }
    })
  }

  private onChange(
    buf:Buffer,
    tick:number,
    firstline:number,
    lastline:number,
    linedata:string[],
    // more:boolean
  ):void {
    if (tick == null) return
    if (buf.id !== this.buffer.id) return
    this._changedtick = tick
    this.lines.splice(firstline, lastline - firstline, ...linedata)
    this._fireContentChanges()
  }

  /**
   * Make sure current document synced correctly
   *
   * @public
   * @returns {Promise<void>}
   */
  public async checkDocument (): Promise<void> {
    this._fireContentChanges.clear()
    this.paused = false
    let {buffer} = this
    // don't listen to terminal buffer
    let buftype = await buffer.getOption('buftype') as string
    if (buftype != '') return this.detach()
    this.lines = await buffer.lines as string[]
    this._changedtick = await buffer.changedtick
    this.createDocument()
    let {version, uri} = this
    this._onDocumentChange.fire({
      textDocument: {version, uri},
      contentChanges: [{text: this.lines.join('\n')}]
    })
    this.generateWords()
  }

  private fireContentChanges():void {
    let {paused, textDocument} = this
    if (paused) return
    this.createDocument()
    let change = getChange(textDocument.getText(), this.content)
    if (!change) return
    let changes = [{
      range: {
        start: textDocument.positionAt(change.start),
        end: textDocument.positionAt(change.end)
      },
      text: change.newText
    }]
    let {version, uri} = this
    this._onDocumentChange.fire({
      textDocument: {version, uri},
      contentChanges: changes
    })
    this.generateWords()
  }

  public detach():void {
    if (!this.attached) return
    this.attached = false
    disposeAll(this.disposables)
    this._fireContentChanges.clear()
    this._onDocumentChange.dispose()
  }

  public get bufnr():number {
    return this.buffer.id
  }

  public get content():string {
    return this.textDocument.getText()
  }

  public get filetype():string {
    return this.textDocument.languageId
  }

  public get uri():string {
    return this.textDocument ? this.textDocument.uri : null
  }

  public get version():number {
    return this.textDocument ? this.textDocument.version : null
  }

  public equalTo(doc:TextDocument):boolean {
    return doc.uri == this.uri
  }

  public setKeywordOption(option: string):void {
    this.chars = new Chars(option)
  }

  public async applyEdits(nvim:Neovim, edits: TextEdit[]):Promise<void> {
    let content = TextDocument.applyEdits(this.textDocument, edits)
    let buffers = await nvim.buffers
    let {bufnr} = this
    let buf = buffers.find(b => b.id == bufnr)
    if (buf) {
      await buf.setLines(content.split(/\r?\n/), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
    }
  }

  public getOffset(lnum:number, col:number):number {
    return this.textDocument.offsetAt({
      line: lnum - 1,
      character: col
    })
  }

  public isWord(word: string):boolean {
    return this.chars.isKeyword(word)
  }

  public getMoreWords():string[] {
    let res = []
    let {words, chars} = this
    if (!chars.isKeywordChar('-')) return res
    for (let word of words) {
      word = word.replace(/^-+/, '')
      if (word.indexOf('-') !== -1) {
        let parts = word.split('-')
        for (let part of parts) {
          if (part.length > 2
            && res.indexOf(part) === -1
            && words.indexOf(part) === -1) {
            res.push(part)
          }
        }
      }
    }
    return res
  }

  /**
   * Current word for replacement, used by completion
   * For increment completion, the document is initialized document
   *
   * @public
   * @param {Position} position
   * @param {string} extraChars?
   * @returns {Range}
   */
  public getWordRangeAtPosition(position:Position, extraChars?:string):Range {
    let {chars, textDocument} = this
    let content = textDocument.getText()
    if (extraChars && extraChars.length) {
      let codes = []
      let keywordOption = '@,'
      for (let i = 0 ; i < extraChars.length; i++) {
        codes.push(String(extraChars.charCodeAt(i)))
      }
      keywordOption += codes.join(',')
      chars = new Chars(keywordOption)
    }
    let start = position
    let end = position
    let offset = textDocument.offsetAt(position)
    for (let i = offset - 1; i >= 0 ; i--) {
      if (i == 0) {
        start = textDocument.positionAt(0)
        break
      } else if (!chars.isKeywordChar(content[i])) {
        start = textDocument.positionAt(i + 1)
        break
      }
    }
    for (let i = offset; i <= content.length ; i++) {
      if (i === content.length) {
        end = textDocument.positionAt(i)
        break
      } else if (!chars.isKeywordChar(content[i])) {
        end = textDocument.positionAt(i)
        break
      }
    }
    return {start, end}
  }

  private includeDash(filetype):boolean {
    return [
      'json',
      'html',
      'wxml',
      'css',
      'less',
      'scss',
      'wxss'
    ].indexOf(filetype) != -1
  }

  private async gitCheck():Promise<void> {
    let {uri} = this
    if (!uri.startsWith('file://')) return
    let filepath = Uri.parse(uri).fsPath
    this.isIgnored = await isGitIgnored(filepath)
  }

  private createDocument(changeCount = 1):void {
    let {version, uri, filetype} = this
    version = version + changeCount
    this.textDocument = TextDocument.create(uri, filetype, version, this.lines.join('\n'))
  }
}
