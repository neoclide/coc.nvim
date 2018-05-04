import Buffer from './model/buffer'
import {filterWord, filterFuzzy} from './util/filter'
import unique = require('array-unique')
import {logger} from './util/logger'

export class Buffers {
  public buffers: Buffer[]
  constructor() {
    this.buffers = []
  }

  public addBuffer(bufnr: string, content: string): void{
    let buf = this.buffers.find(buf => buf.bufnr === bufnr)
    if (buf) {
      buf.setContent(content)
    } else {
      this.buffers.push(new Buffer(bufnr, content))
    }
 }

  public removeBuffer(bufnr: string): void {
    let idx = this.buffers.findIndex(o => o.bufnr === bufnr)
    if (idx !== -1) {
      this.buffers.splice(idx, 1)
    }
  }

  public getWords(bufnr: string, input: string, filter: string):string[] {
    let words: string[] = []
    for (let buf of this.buffers) {
      let arr = bufnr === buf.bufnr ? buf.moreWords : buf.words
      words = words.concat(arr)
    }
    words = unique(words)
    words = filter === 'word' ? filterWord(words, input) : filterFuzzy(words, input)
    return words.slice(0, 50)
  }

  public getBuffer(bufnr: string): Buffer | null {
    let buf = this.buffers.find(o => o.bufnr == bufnr)
    return buf || null
  }
}

const buffers = new Buffers()
export default buffers
