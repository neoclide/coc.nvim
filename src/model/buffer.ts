import unique = require('array-unique')
import crypto = require('crypto')
const {createHash} = crypto

export default class Buffer {
  public words: string[]
  public moreWords: string[]
  public hash: string
  public keywordsRegex: RegExp
  public keywordRegex: RegExp
  constructor(public bufnr: string, public content: string, public keywordRegStr : string) {
    this.bufnr = bufnr
    this.content = content
    this.keywordsRegex = new RegExp(`${keywordRegStr}{3,}`, 'g')
    this.keywordRegex = new RegExp(`^${keywordRegStr}+$`, 'g')
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
    words = unique(words) as string[]
    let arr = Array.from(words)
    for (let word of words) {
      let ms = word.match(/^(\w{3,})-/)
      if (ms && words.indexOf(ms[0]) === -1) {
        arr.unshift(ms[1])
      }
      ms = word.match(/^(\w{3,})_/)
      if (ms && words.indexOf(ms[0]) === -1) {
        arr.unshift(ms[1])
      }
    }
    this.words = words
    this.moreWords = unique(arr)
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
