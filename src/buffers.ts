import { Neovim } from 'neovim'
import Buffer from './model/buffer'
import Doc from './model/document'
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
    let doc = new Doc(uri, filetype, version, content, keywordOption)
    this.document = doc
    return doc
  }

  public async addBuffer(nvim: Neovim, bufnr: string): Promise<void>{
    let lines: string[] = await nvim.call('getbufline', [Number(bufnr), 1, '$'])
    let content = (lines as string[]).join('\n')
    if (/\u0000/.test(content)) return
    let keywordOption = await nvim.call('getbufvar', [Number(bufnr), '&iskeyword'])
    let buf = this.buffers.find(buf => buf.bufnr == bufnr)
    if (buf) {
      buf.setContent(content)
    } else {
      this.buffers.push(new Buffer(bufnr, content, keywordOption))
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

  public async refresh(nvim: Neovim):Promise<void> {
    let bufs:number[] = await nvim.call('complete#util#get_buflist', [])
    this.buffers = []
    for (let buf of bufs) {
      await this.addBuffer(nvim, buf.toString())
    }
    logger.info('Buffers refreshed')
  }
}

const buffers = new Buffers()
export default buffers
