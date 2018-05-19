import { Neovim } from 'neovim'
import {CompleteOption} from './types'
import Buffer from './model/buffer'
import Doc from './model/document'
import {getConfig} from './config'
import {MAX_CODE_LINES} from './constant'
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

  public async createDocument(nvim:Neovim, opt:CompleteOption):Promise<void> {
    let ts = Date.now()
    let {filetype, bufnr, iskeyword} = opt
    let uri = `buffer://${bufnr}`
    let content = await this.loadBufferContent(nvim, bufnr)
    let version = this.versions[uri]
    version = version ? version + 1 : 1
    this.versions[uri] = version
    let doc = new Doc(uri, filetype, version, content, iskeyword)
    this.document = doc
    logger.debug(`Content load cost: ${Date.now() - ts}`)
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

  public async loadBufferContent(nvim:Neovim, bufnr:number, timeout = 1000):Promise<string|null> {
    let count:number = await nvim.call('nvim_buf_line_count', [bufnr])
    if (count > MAX_CODE_LINES) return null
    return await nvim.call('coc#util#get_content', [bufnr])
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
