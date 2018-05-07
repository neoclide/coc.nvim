import crypto = require('crypto')
import {logger} from '../util/logger'
import {Chars} from './chars'
const {createHash} = crypto

export default class Buffer {
  public words: string[]
  public hash: string
  private chars: Chars
  constructor(public bufnr: string, public content: string, public keywordOption : string) {
    this.bufnr = bufnr
    this.content = content
    this.chars = new Chars(keywordOption)
    this.generate()
  }

  public isWord(word: string):boolean {
    return this.chars.isKeyword(word)
  }

  private generate(): void {
    let {content} = this
    if (content.length == 0) return
    this.words = this.chars.matchKeywords(content)
    this.hash = createHash('md5').update(content).digest('hex')
  }

  public setKeywordOption(option: string):void {
    this.chars = new Chars(option)
    this.generate()
  }

  public setContent(content: string):void {
    this.content = content
    this.generate()
  }
}
