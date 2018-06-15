import { Neovim } from 'neovim'
import {
  Uri
} from '../util'
import {
  TextDocument,
  Position,
  Range,
  TextEdit } from 'vscode-languageserver-protocol'
import {Chars} from './chars'
import {
  isGitIgnored,
} from '../util/fs'
const logger = require('../util/logger')('model-document')

// wrapper class of TextDocument
export default class Document {
  public words: string[]
  public isIgnored = false
  public chars:Chars
  constructor(
    public bufnr:number,
    public textDocument:TextDocument,
    public keywordOption:string) {
    let chars = this.chars = new Chars(keywordOption)
    if (this.includeDash) {
      chars.addKeyword('-')
    }
    this.generate()
    this.gitCheck().catch(err => {
      // noop
    })
  }

  private get includeDash():boolean {
    let {languageId} = this.textDocument
    return [
      'json',
      'html',
      'wxml',
      'css',
      'less',
      'scss',
      'wxss'
    ].indexOf(languageId) != -1
  }

  private async gitCheck():Promise<void> {
    let {uri} = this
    if (!uri.startsWith('file://')) return
    let filepath = Uri.parse(uri).fsPath
    this.isIgnored = await isGitIgnored(filepath)
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

  public changeDocument(doc:TextDocument):void {
    this.textDocument = doc
    this.generate()
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

  private generate(): void {
    let {content} = this
    if (content.length == 0) {
      this.words = []
    } else {
      this.words = this.chars.matchKeywords(content)
    }
  }

  public getWordRangeAtPosition(position:Position, extraChars?:string):Range {
    let {chars, content, textDocument} = this
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
}
