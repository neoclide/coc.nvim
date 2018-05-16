import { Neovim } from 'neovim'
import Buffer from './model/buffer'
import Doc from './model/document'
import {getConfig} from './config'
import {
  isGitIgnored,
  readFile,
  statAsync} from './util/fs'
const logger = require('./util/logger')('buffers')

let checkdFiles:string[] = []

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

  public async addBuffer(nvim: Neovim, bufnr: number): Promise<void>{
    let buf = this.buffers.find(buf => buf.bufnr == bufnr)
    let checkGit = getConfig('checkGit')
    if (!buf && checkGit) {
      let fullpath = await nvim.call('coc#util#get_fullpath', [bufnr])
      if (checkdFiles.indexOf(fullpath) !== -1) {
        let ignored = await isGitIgnored(fullpath)
        if (ignored) return
        checkdFiles.push(fullpath)
      }
    }
    let content = await this.loadBufferContent(nvim, bufnr)
    if (/\u0000/.test(content) || !content) return
    let keywordOption = await nvim.call('getbufvar', [bufnr, '&iskeyword'])
    if (buf) {
      buf.setContent(content)
    } else {
      this.buffers.push(new Buffer(bufnr, content, keywordOption))
    }
  }

  public async loadBufferContent(nvim:Neovim, bufnr:number, timeout = 1000):Promise<string> {
    let count:number = await nvim.call('nvim_buf_line_count', [bufnr])
    let content = ''
    if (count > 3000) {
      // file too big, read file from disk
      let filepath = await nvim.call('coc#util#get_fullpath', [bufnr])
      if (!filepath) return ''
      let stat = await statAsync(filepath)
      if (!stat) return ''
      let encoding = await nvim.call('getbufvar', [bufnr, '&fileencoding'])
      content = await readFile(filepath, encoding, timeout)
    } else {
      let lines: string[] = await nvim.call('nvim_buf_get_lines', [bufnr, 0, -1, 0])
      content = (lines as string[]).join('\n')
    }
    return content
  }

  public removeBuffer(bufnr: number): void {
    let idx = this.buffers.findIndex(o => o.bufnr == bufnr)
    if (idx !== -1) {
      this.buffers.splice(idx, 1)
    }
  }

  public getWords(bufnr: number):string[] {
    let words: string[] = []
    for (let buf of this.buffers) {
      if (bufnr == buf.bufnr) continue
      for (let word of buf.words) {
        if (words.indexOf(word) == -1) {
          words.push(word)
        }
      }
    }
    return words
  }

  public getBuffer(bufnr: number): Buffer | null {
    let buf = this.buffers.find(o => o.bufnr == bufnr)
    return buf || null
  }

  public async refresh(nvim: Neovim):Promise<void> {
    let bufs:number[] = await nvim.call('coc#util#get_buflist', [])
    this.buffers = []
    for (let buf of bufs) {
      await this.addBuffer(nvim, buf)
    }
    checkdFiles = []
    logger.info('Buffers refreshed')
  }
}

const buffers = new Buffers()
export default buffers
