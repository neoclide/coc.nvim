import {CompleteOption, VimCompleteItem, CompleteResult} from '../types'
import {logger} from '../util/logger'
import buffers from '../buffers'
import Source from './source'

export type Callback = () => void

export default class Complete {
  // identify this complete
  public id: string
  private bufnr: string
  private line: number
  private col: number
  private input: string
  private word: string
  private filetype: string
  private running: boolean
  private result: VimCompleteItem[] | null
  private callbacks: Callback[]
  constructor(opts: Partial<CompleteOption>) {
    let {bufnr, line, col, input, filetype, word} = opts
    let buf = buffers.getBuffer(bufnr.toString())
    if (!buf) {
      this.id = ''
    } else {
      this.id = `${buf.hash}|${line}|${col}`
    }
    this.word = word || ''
    this.bufnr = bufnr || ''
    this.line = line || 0
    this.col = col || 0
    this.input = input || ''
    this.filetype = filetype || ''
    this.result = null
    this.callbacks = []
    let self = this
    let running = false
    Object.defineProperty(this, 'running', {
      get():boolean {
        return running
      },
      set(newValue: boolean):void {
        running = newValue
        if (newValue === false && self.callbacks.length) {
          let callback = self.callbacks.pop()
          callback()
          self.callbacks = []
        }
      }
    })
  }

  public getOption():CompleteOption | null {
    if (!this.id) return null
    return {
      filetype: this.filetype,
      bufnr: this.bufnr,
      line: this.line,
      col: this.col,
      input: this.input,
      id: this.id,
      word: this.word,
    }
  }

  private completeSource(source: Source, opt: CompleteOption): Promise<CompleteResult | null> {
    return new Promise(resolve => {
      let called = false
      let start = Date.now()
      source.doComplete(opt).then(result => {
        called = true
        resolve(result)
        logger.info(`Complete '${source.name}' takes ${Date.now() - start}ms`)
      }, error => {
        called = true
        logger.error(`Complete error of source '${source.name}'`)
        logger.error(error.stack)
        resolve(null)
      })
      setTimeout(() => {
        if (!called) {
          logger.warn(`Complete source '${source.name}' too slow!`)
          resolve(null)
        }
      }, 300)
    })
  }

  public async doComplete(sources: Source[]): Promise<VimCompleteItem[]> {
    if (this.result) return this.result
    if (this.running === true) {
      let p = new Promise(resolve => {
        this.callbacks.push(() => {
          resolve()
        })
        setTimeout(() => {
          resolve()
        }, 1000)
      })
      await p
      return this.result
    }
    this.running = true
    let opts = this.getOption()
    if (opts === null) return [] as VimCompleteItem[]
    sources.sort((a, b) => b.priority - a.priority)
    let {filetype, word, input} = this
    let valids: Source[] = []
    logger.debug('input:' + opts.input)
    logger.debug('len:' + opts.input.length)
    for (let s of sources) {
      let shouldRun = await s.shouldComplete(opts)
      logger.debug('shouldRun:' + shouldRun)
      if (!shouldRun) continue
      let {filetypes} = s
      if (filetypes.length && filetypes.indexOf(filetype) == -1) continue
      valids.push(s)
    }
    if (valids.length == 0) {
      logger.debug('No source to complete')
      return []
    }
    let source = valids.find(s => s.engross === true)
    if (source) valids = [source]
    let result = await Promise.all(valids.map(s => this.completeSource(s, opts)))

    let arr: VimCompleteItem[] = []
    for (let res of result) {
      if (res == null) continue
      let {items, offsetLeft, offsetRight} = res
      let hasOffset = !!offsetLeft || !!offsetRight
      let user_data =  hasOffset ? JSON.stringify({
        offsetLeft: offsetLeft || 0,
        offsetRight: offsetRight || 0
      }) : null
      for (let item of items) {
        // filter unnecessary results
        if (item.word == word || item.word == input) continue
        if (user_data) {
          item.user_data = user_data
        }
        arr.push(item)
      }
    }
    this.result = arr
    this.running = false
    return arr
  }
}
