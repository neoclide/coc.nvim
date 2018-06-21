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
  isGitIgnored,
} from '../util/fs'
import debounce = require('debounce')
import diff = require('diff')
import {getTextEdit} from '../util/diff'
const logger = require('../util/logger')('model-document')

function createEdit(start:Partial<Position>, end:Partial<Position>, newText):TextEdit {
  let range = {
    start: {
      character: 0,
      ...start
    },
    end: {
      character: 0,
      ...end
    }
  }
  return {range, newText} as TextEdit
}

// wrapper class of TextDocument
export default class Document {
  public isIgnored = false
  public chars:Chars
  public paused: boolean
  public textDocument: TextDocument
  private pausedDocument: TextDocument
  private textEdits:TextEdit[] = []
  private _fireContentChanges: Function & { clear(): void; }
  private _onDocumentChange = new EventEmitter<DidChangeTextDocumentParams>()
  private attached = false
  private hasChange = false
  private disposables:Disposable[] = []
  public readonly words:string[]
  public readonly onDocumentChange: Event<DidChangeTextDocumentParams> = this._onDocumentChange.event
  constructor(public buffer:Buffer) {
    this._fireContentChanges = debounce(async () => {
      try {
        await this.fireContentChanges()
      } catch (e) {
        logger.error(`Content change error: ` + e.stack)
      }
    }, 20)
    let paused = false
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
    Object.defineProperty(this, 'paused', {
      get: () => {
        return paused
      },
      set: (val:boolean) => {
        if (val === paused) return
        if (val) {
          paused = true
          this.pausedDocument = this.textDocument
        } else {
          this.fireDocumentChanges()
          paused = false
        }
      }
    })
  }

  public async init(nvim:Neovim):Promise<void> {
    let {buffer} = this
    let opts = await nvim.call('coc#util#get_bufoptions', [buffer.id]) as BufferOption
    let {fullpath, changedtick, filetype, iskeyword} = opts
    let uri = getUri(fullpath, buffer.id)
    let chars = this.chars = new Chars(iskeyword)
    if (this.includeDash(filetype)) chars.addKeyword('-')
    let content = (await buffer.lines).join('\n')
    this.textDocument = TextDocument.create(uri, filetype, changedtick, content)
    this.attach()
    this.hasChange = true
    this.attached = true
    this.gitCheck().catch(e => {
      logger.error('git error', e.stack)
    })
  }

  public attach():void {
    let unbindLines = this.buffer.listen('lines', (...args) => {
      try {
        this.onChange.apply(this, args)
      } catch(e) {
        logger.error(e.stack)
      }
    })
    let unbindChangetick = this.buffer.listen('changedtick', (buffer, tick) => {
      if (buffer.id != this.bufnr) return
      let content = this.textDocument.getText()
      let {uri, languageId} = this.textDocument
      this.textDocument = TextDocument.create(uri, languageId, tick, content)
    })
    this.disposables.push({
      dispose: () => {
        unbindLines()
        unbindChangetick()
      }
    })
  }

  public getline(line:number):string {
    if (line < 0) return null
    let lines = this.content.split('\n')
    return lines[line] || null
  }

  public async checkDocument():Promise<void> {
    this.paused = false
    this.textEdits = []
    let buffer:Buffer = this.buffer as Buffer
    let buftype = await buffer.getOption('buftype') as string
    if (buftype !== '') return this.detach()
    let filetype = (await buffer.getOption('filetype') as string)
    let version = await buffer.getVar('changedtick') as number
    let content = (await buffer.lines as string[]).join('\n')
    if (this.content != content) {
      let res = diff.diffChars(this.content, content)
      logger.error('--------------------')
      logger.error('content diff:', res)
      logger.error('content length:', this.content.length, content.length)
      let {uri} = this
      this._fireContentChanges.clear()
      this.textDocument = TextDocument.create(uri, filetype, version, content)
      this.hasChange = true
      this._onDocumentChange.fire({
        textDocument: {version, uri},
        contentChanges: [{ text: content }]
      })
    }
  }

  private async fireContentChanges():Promise<void> {
    let {textEdits} = this
    if (textEdits.length == 0) return
    this.textEdits = []
    let {uri, version, paused} = this
    if (paused) return
    this._onDocumentChange.fire({
      textDocument: {version, uri},
      contentChanges: textEdits.map(o => {
        return {
          range: o.range,
          text: o.newText
        }
      })
    })
  }

  private onChange(
    buf:Buffer,
    tick:number,
    firstline:number,
    lastline:number,
    linedata:string[],
    more:boolean
  ):void {
    if (tick == null) return
    if (buf.id !== (this.buffer as Buffer).id) return
    let textEdits:TextEdit[] = []
    let newText = linedata.map(s => s + '\n').join('')
    let totalLines = this.textDocument.lineCount
    // fix that last line should not have `\n`
    if (lastline == totalLines && newText.length) {
      newText = newText.slice(0, -1)
    }
    if (linedata.length && firstline == totalLines) {
      // add new lines, we should prepend `\n`
      newText = '\n' + newText
    }
    textEdits.push(createEdit(
      {line:firstline},
      {line:lastline},
      newText))
    // removing lastline should remove `\n` from lastline
    if (lastline == totalLines && linedata.length == 0) {
      let idx = firstline - 1
      let line = this.getline(idx)
      if (line != null) {
        textEdits.push(createEdit(
          {line: idx, character: line.length},
          {line: idx + 1},
          ''
        ))
      }
    }
    this.textEdits = this.textEdits.concat(textEdits)
    let content = TextDocument.applyEdits(this.textDocument, textEdits)
    let {languageId, uri} = this.textDocument
    this.textDocument = TextDocument.create(uri, languageId, tick, content)
    this.hasChange = true
    this._fireContentChanges()
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

  public getWordRangeAtPosition(position:Position, extraChars?:string):Range {
    let {chars, pausedDocument} = this
    let textDocument = pausedDocument || this.textDocument
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

  private fireDocumentChanges():void {
    let orig = this.pausedDocument
    let curr = this.textDocument
    if (!orig || !curr) return
    let textEdit = getTextEdit(orig, curr)
    if (!textEdit) return
    let {version, uri} = curr
    this.pausedDocument = null
    this._onDocumentChange.fire({
      textDocument: {version, uri},
      contentChanges: [{
        range: textEdit.range,
        text: textEdit.newText
      }]
    })
  }
}
