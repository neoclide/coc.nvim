import Buffer from './model/buffer'
import Doc from './model/document'
import {getKeywordsRegStr} from './util/index'
import {logger} from './util/logger'
import unique = require('array-unique')

export class Buffers {
  public buffers: Buffer[]
  public versions: {[index: string] : number}
  public document: Doc
  constructor() {
    this.buffers = []
    this.versions = {}
  }

  public createDocument(uri: string, filetype: string, content: string, keywordOption: string):Doc {
    let version = this.versions[uri]
    version = version ? version + 1 : 1
    this.versions[uri] = version
    let keywordRegStr = getKeywordsRegStr(keywordOption)
    logger.debug(`str:${keywordRegStr}`)
    let doc = new Doc(uri, filetype, version, content, keywordRegStr)
    logger.debug(`abc`)
    this.document = doc
    return doc
  }

  public addBuffer(bufnr: string, content: string, keywordOption: string): void{
    let buf = this.buffers.find(buf => buf.bufnr === bufnr)
    if (buf) {
      buf.setContent(content)
    } else {
      let keywordRegStr = getKeywordsRegStr(keywordOption)
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
      if (bufnr === buf.bufnr) continue
      words = words.concat(buf.words)
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
