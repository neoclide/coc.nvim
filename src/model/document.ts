import { Neovim, Buffer } from 'neovim'
import {
  Uri,
  BufferOption,
} from '../types'
import {
  TextDocument,
  Position,
  Range,
  TextEdit,
  DidChangeTextDocumentParams,
} from 'vscode-languageserver-protocol'
import {Chars} from './chars'
import {
  EventEmitter,
  Event,
  Disposable,
  disposeAll,
  getUri,
} from '../util/index'
import {
  equals
} from '../util/object'
import {
  isGitIgnored,
} from '../util/fs'
import debounce = require('debounce')
const logger = require('../util/logger')('model-document')

interface Edit {
  singleLine?: number
  range: Range,
  newText: string
}

function createEdit(start:{line:number, character?:number}, end:{line:number, character?: number}, newText):Edit {
  let range:Range = {
    start: {
      character: 0,
      ...start
    },
    end: {
      character: 0,
      ...end
    }
  }
  return {range, newText}
}

// wrapper class of TextDocument
export default class Document {
  public isIgnored = false
  public chars:Chars
  public paused: boolean
  public textDocument: TextDocument
  private textEdits:Edit[] = []
  private _fireContentChanges: Function & { clear(): void; }
  private _onDocumentChange = new EventEmitter<DidChangeTextDocumentParams>()
  private attached = false
  private hasChange = false
  private disposables:Disposable[] = []
  // real current lines
  private lines:string[] = []
  private _changedtick:number
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
    let words = []
    Object.defineProperty(this, 'words', {
      get: () => {
        // generate it when used
        if (!this.hasChange) return words
        let {content} = this
        words = this.chars.matchKeywords(content)
        this.hasChange = false
        return words
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
    this.hasChange = true
    this.attached = true
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
    let unbindChange = this.buffer.listen('changedtick', (buf:Buffer, tick:number) => {
      if (buf.id !== this.buffer.id) return
      this._changedtick = tick
    })
    this.disposables.push({
      dispose: () => {
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
    let textEdits:Edit[] = []
    let newText = linedata.map(s => s + '\n').join('')
    let totalLines = this.lines.length
    // fix that last line should not have `\n`
    if (lastline == totalLines && newText.length) {
      newText = newText.slice(0, -1)
    }
    if (linedata.length && firstline == totalLines) {
      // add new lines, we should prepend `\n`
      newText = '\n' + newText
    }
    let edit = createEdit( {line:firstline}, {line:lastline}, newText)
    // removing lastline should remove `\n` from lastline
    if (lastline == totalLines && linedata.length == 0) {
      let idx = firstline - 1
      let line = this.lines[idx]
      if (line != null) {
        edit.range.start = {line: idx, character: line.length}
      }
    }
    textEdits.push(edit)
    this.textEdits = this.textEdits.concat(textEdits)
    this.lines.splice(firstline, lastline - firstline, ...linedata)
    this._fireContentChanges()
  }

  /**
   * Make sure current document synced correctly
   *
   * @public
   * @returns {Promise<void>}
   */
  public async checkDocument():Promise<void> {
    this._fireContentChanges.clear()
    this.paused = false
    let {buffer} = this
    // don't listen to terminal buffer
    let buftype = await buffer.getOption('buftype') as string
    if (buftype !== '') return this.detach()
    this.lines = await buffer.lines as string[]
    // let content = lines.join('\n')
    // if (this.content != content) {
    //   let res = diff.diffLines(this.content, content)
    //   logger.error('--------------------')
    //   logger.error('content diff:', res)
    //   logger.error('content length:', this.content.length, content.length)
    //   this.lines = lines
    // }
    this.createDocument()
    let {version, uri} = this
    this.hasChange = true
    this._onDocumentChange.fire({
      textDocument: {version, uri},
      contentChanges: [{ text: this.lines.join('\n') }]
    })
  }

  private fireContentChanges():void {
    let {paused, textEdits} = this
    if (paused || textEdits.length == 0) return
    let edits = this.mergeTextEdits(textEdits)
    this.textEdits = []
    this.createDocument(edits.length)
    let changes = edits.map(edit => {
      return {
        range: edit.range,
        text: edit.newText
      }
    })
    let {version, uri} = this
    this.hasChange = true
    this._onDocumentChange.fire({
      textDocument: {version, uri},
      contentChanges: changes
    })
  }

  public detach():void {
    if (!this.attached) return
    this.attached = false
    this._fireContentChanges.clear()
    this._onDocumentChange.dispose()
    disposeAll(this.disposables)
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
    return this.textDocument.uri
  }

  public get version():number {
    return this.textDocument.version
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
   * For increment completion, the document is initailized document
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

  private mergeTextEdits(edits: TextEdit[]):TextEdit[] {
    let res: TextEdit[] = []
    let last: TextEdit = null
    for (let edit of edits) {
      if (last
        && last.newText.trim().indexOf('\n') == -1
        && edit.newText.trim().indexOf('\n') == -1
        && equals(last.range, edit.range)) {
        last.newText = edit.newText
      } else {
        res.push(edit)
        last = edit
      }
    }
    return res
  }
}
