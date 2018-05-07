import unique = require('array-unique')
import crypto = require('crypto')
import {logger} from '../util/logger'
const {createHash} = crypto

export default class Buffer {
  public words: string[]
  public hash: string
  public keywordsRegex: RegExp
  public keywordRegex: RegExp
  constructor(public bufnr: string, public content: string, public keywordRegStr : string) {
    this.bufnr = bufnr
    this.content = content
    this.keywordsRegex = new RegExp(`${keywordRegStr}{3,}`, 'g')
    this.keywordRegex = new RegExp(`^${keywordRegStr}+$`)
    this.generateWords()
    this.genHash(content)
  }

  public isWord(word: string):boolean {
    return this.keywordRegex.test(word)
  }

  private generateWords(): void {
    let {content, keywordsRegex} = this
    if (content.length == 0) return
    let words = content.match(keywordsRegex) || []
    this.words = unique(words)
  }

  private genHash(content: string): void {
    this.hash = createHash('md5').update(content).digest('hex')
  }

  public setContent(content: string):void {
    this.content = content
    this.generateWords()
    this.genHash(content)
  }
}
