import Buffer from './model/buffer'
import {getKeywordsRegEx} from './util/index'
import unique = require('array-unique')
import {logger} from './util/logger'

export class Buffers {
  public buffers: Buffer[]
  constructor() {
    this.buffers = []
  }

  public addBuffer(bufnr: string, content: string, keywordOption: string): void{
    let buf = this.buffers.find(buf => buf.bufnr === bufnr)
    if (buf) {
      buf.setContent(content)
    } else {
      let keywordRe = getKeywordsRegEx(keywordOption)
      this.buffers.push(new Buffer(bufnr, content, keywordRe))
    }
 }

  public removeBuffer(bufnr: string): void {
    let idx = this.buffers.findIndex(o => o.bufnr === bufnr)
    if (idx !== -1) {
      this.buffers.splice(idx, 1)
    }
  }

  public getWords(bufnr: string):string[] {
    let words: string[] = []
    for (let buf of this.buffers) {
      let arr = bufnr === buf.bufnr ? buf.moreWords : buf.words
      words = words.concat(arr)
    }
    return unique(words)
  }

  public getBuffer(bufnr: string): Buffer | null {
    let buf = this.buffers.find(o => o.bufnr == bufnr)
    return buf || null
  }
}

const buffers = new Buffers()
export default buffers
