import Buffer from './model/buffer'
import {getKeywordsRegStr} from './util/index'
import {logger} from './util/logger'
import unique = require('array-unique')

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
      let keywordRegStr = getKeywordsRegStr(keywordOption, 2)
      this.buffers.push(new Buffer(bufnr, content, keywordRegStr))
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
