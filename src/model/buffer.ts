import {Chars} from './chars'
const logger = require('../util/logger')('model-buffer')

export default class Buffer {
  public words: string[]
  private chars: Chars
  constructor(public bufnr: number, public content: string, public keywordOption : string) {
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
    // TODO for performance, this have to be implemented in C code
    this.words = this.chars.matchKeywords(content)
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
