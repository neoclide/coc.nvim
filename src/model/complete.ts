/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import {CompleteOption,
  VimCompleteItem,
  CompleteResult} from '../types'
import { Neovim } from 'neovim'
import {logger} from '../util/logger'
import buffers from '../buffers'
import Source from './source'
import {getConfig} from '../config'
import {score} from 'fuzzaldrin'
import {wordSortItems} from '../util/sorter'
import fuzzysearch = require('fuzzysearch')

export type Callback = () => void

export default class Complete {
  // identify this complete
  public id: string
  public results: CompleteResult[] | null
  private bufnr: string
  private linenr: number
  private colnr: number
  private line: string
  private col: number
  private input: string
  private word: string
  private filetype: string
  private fuzzy: boolean
  constructor(opts: Partial<CompleteOption>) {
    let {bufnr, line, linenr, colnr, col, input, filetype, word} = opts
    let buf = buffers.getBuffer(bufnr.toString())
    if (!buf) {
      this.id = ''
    } else {
      this.id = `${buf.hash}|${linenr}`
    }
    this.word = word || ''
    this.bufnr = bufnr || ''
    this.linenr = linenr || 0
    this.line = line || ''
    this.col = col || 0
    this.colnr = colnr
    this.input = input || ''
    this.filetype = filetype || ''
    this.fuzzy = getConfig('fuzzyMatch')
  }

  public getOption():CompleteOption | null {
    if (!this.id) return null
    return {
      colnr: this.colnr,
      filetype: this.filetype,
      bufnr: this.bufnr,
      linenr: this.linenr,
      line: this.line,
      col: this.col,
      input: this.input,
      id: this.id,
      word: this.word,
    }
  }

  public resuable(complete: Complete):boolean {
    let {id, col, word, colnr, input, line, linenr} = complete
    if (!id || id !== this.id || !this.results
      || linenr !== this.linenr
      || colnr < this.colnr
      || !input.startsWith(this.input)
      || col !== this.col) return false
    return line.slice(0, col) == this.line.slice(0, col)
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

  public filterResults(results: CompleteResult[], input: string, cword: string):VimCompleteItem[] {
    let arr: VimCompleteItem[] = []
    let {fuzzy} = this
    let cFirst = input.length ? input[0].toLowerCase() : null
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      if (res == null) continue
      let {items, offsetLeft, offsetRight, firstMatch} = res
      let hasOffset = !!offsetLeft || !!offsetRight
      let user_data =  hasOffset ? JSON.stringify({
        offsetLeft: offsetLeft || 0,
        offsetRight: offsetRight || 0
      }) : null
      for (let item of items) {
        let {word} = item
        if (word.length <= 1) return
        let first = word[0].toLowerCase()
        // first must match for no kind
        if (firstMatch && cFirst && cFirst !== first) continue
        // filter unnecessary no kind results
        if (!item.kind && (input.length == 0 || word == cword || word == input)) continue
        if (input.length && !fuzzysearch(input, word)) continue

        if (user_data) {
          item.user_data = user_data
        }
        if (fuzzy) item.score = score(item.word, input) + (item.kind ? 0.01 : 0)
        arr.push(item)
      }
    }
    if (fuzzy) {
      arr.sort((a, b) => {
        return b.score - a.score
      })
    } else {
      arr = wordSortItems(arr, input)
    }
    return arr
  }

  public async doComplete(sources: Source[]): Promise<VimCompleteItem[]> {
    let opts = this.getOption()
    if (opts === null) return [] as VimCompleteItem[]
    // if (this.result) return this.result
    sources.sort((a, b) => b.priority - a.priority)
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
    let engrossIdx = valids.findIndex(s => s.engross === true)
    logger.debug(`Enabled sources: ${valids.map(s => s.name).join(',')}`)
    let results = await Promise.all(valids.map(s => this.completeSource(s, opts)))

    let isBad = false
    results = results.filter(r => {
      if (r == null) {
        isBad = true
        return false
      }
      return true
    })

    if (engrossIdx && results[engrossIdx]) {
      let {items} = results[engrossIdx]
      if (items.length) results = [results[engrossIdx]]
    }
    if (!isBad) {
      this.results = results
    }
    let {input, word} = this
    return this.filterResults(results, input, word)
  }
}
