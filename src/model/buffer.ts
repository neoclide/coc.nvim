import {getConfig} from '../config'
import unique = require('array-unique')
import crypto = require('crypto')
import {logger} from '../util/logger'
const {createHash} = crypto

export default class Buffer {
  public words: string[]
  public moreWords: string[]
  public hash: string
  constructor(public bufnr: string, public content: string) {
    this.bufnr = bufnr
    this.content = content
    this.generateWords()
    this.genHash(content)
  }
  private generateWords(): void {
    let {content} = this
    if (content.length == 0) return
    let regex: RegExp = getConfig('keywordsRegex') as RegExp
    let words = content.match(regex) || []
    words = words.filter(w => w.length > 1)
    words = unique(words) as string[]
    let arr = Array.from(words)
    for (let word of words) {
      let ms = word.match(/^(\w+)-/)
      if (ms && words.indexOf(ms[0]) === -1) {
        arr.unshift(ms[1])
      }
      ms = word.match(/^(\w+)_/)
      if (ms && words.indexOf(ms[0]) === -1) {
        arr.unshift(ms[1])
      }
    }
    this.words = words
    this.moreWords = arr
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
