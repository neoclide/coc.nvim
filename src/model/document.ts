import { TextDocument, TextEdit } from 'vscode-languageserver-types'
import unique = require('array-unique')
import {logger} from '../util/logger'

export default class Doc {
  public doc: TextDocument
  public keywordsRegex: RegExp
  public content: string
  constructor(uri: string, filetype: string, version: number, content: string, keywordRegStr: string) {
    this.keywordsRegex = new RegExp(`${keywordRegStr}{3,}`, 'g')
    this.doc = TextDocument.create(uri, filetype, version, content)
    this.content = content
  }

  public applyEdits(edits: TextEdit[]):string {
    return TextDocument.applyEdits(this.doc, edits)
  }

  public getWords():string[] {
    let {content} = this
    let {keywordsRegex} = this
    if (content.length == 0) return []
    let words = content.match(keywordsRegex) || []
    words = unique(words) as string[]
    for (let word of words) {
      let ms = word.match(/^(\w{3,})[\\-_]/)
      if (ms && words.indexOf(ms[0]) == -1) {
        words.unshift(ms[1])
      }
    }
    return words
  }
}
