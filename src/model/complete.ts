/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import {CompleteOption, VimCompleteItem, CompleteResult} from '../types'
import { Neovim } from 'neovim'
import {logger} from '../util/logger'
import buffers from '../buffers'
import Source from './source'
import {getConfig} from '../config'
import {score} from 'fuzzaldrin'
import {wordSortItems} from '../util/sorter'

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
  private result: VimCompleteItem[] | null
  private nvim: Neovim
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
    this.callbacks = []
    let self = this
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
      }, getConfig('timeout'))
    })
  }

  public async doComplete(sources: Source[]): Promise<VimCompleteItem[]> {
    let opts = this.getOption()
    if (opts === null) return [] as VimCompleteItem[]
    if (this.result) return this.result
    sources.sort((a, b) => b.priority - a.priority)
    let {filetype, word, input} = this
    let valids: Source[] = []
    for (let s of sources) {
      let shouldRun = await s.shouldComplete(opts)
      if (!shouldRun) continue
      valids.push(s)
    }
    if (valids.length == 0) {
      logger.debug('No source to complete')
      return []
    }
    let source = valids.find(s => s.engross === true)
    if (source) valids = [source]
    logger.debug(`Enabled sources: ${valids.map(s => s.name).join(',')}`)
    valids.sort((a, b) => b.priority - a.priority)
    let result = await Promise.all(valids.map(s => this.completeSource(s, opts)))
    let arr: VimCompleteItem[] = []
    let useFuzzy = getConfig('fuzzyMatch')
    for (let i = 0, l = result.length; i < l; i++) {
      let res = result[i]
      if (res == null) continue
      let {items, offsetLeft, offsetRight} = res
      let hasOffset = !!offsetLeft || !!offsetRight
      let user_data =  hasOffset ? JSON.stringify({
        offsetLeft: offsetLeft || 0,
        offsetRight: offsetRight || 0
      }) : null
      let s_score = Number(valids[i].priority)/100
      for (let item of items) {
        // filter unnecessary results
        if (item.word == word || item.word == input) continue
        if (user_data) {
          item.user_data = user_data
        }
        if (useFuzzy) item.score = score(item.word, input) + s_score
        arr.push(item)
      }
    }
    if (useFuzzy) {
      arr.sort((a, b) => {
        return b.score - a.score
      })
    } else {
      arr = wordSortItems(arr, input)
    }
    this.result = arr
    return arr
  }
}
