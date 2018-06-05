import {
  TextDocument,
  TextEdit } from 'vscode-languageserver-types'
import {getConfig} from '../config'
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
  constructor(public textDocument:TextDocument, public keywordOption:string) {
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
      'html',
      'wxml',
      'css',
      'less',
      'scss',
      'wxss'
    ].indexOf(languageId) != -1
  }

  private async gitCheck():Promise<void> {
    let checkGit = getConfig('checkGit')
    if (!checkGit) return
    let {uri} = this
    if (!uri.startsWith('file://')) return
    this.isIgnored = await isGitIgnored(uri.replace('file://', ''))
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

  public applyEdits(edits: TextEdit[]):string {
    return TextDocument.applyEdits(this.textDocument, edits)
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
}
