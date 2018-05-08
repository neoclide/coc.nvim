import {score} from 'fuzzaldrin'
import { Neovim } from 'neovim'
import {CompleteOption,
  VimCompleteItem,
  CompleteResult} from '../types'
import buffers from '../buffers'
import Source from './source'
import {getConfig} from '../config'
import {logger} from '../util/logger'
import {wordSortItems} from '../util/sorter'
import {uniqueItems} from '../util/unique'
import {filterFuzzy, filterWord} from '../util/filter'

export type Callback = () => void

export default class Complete {
  // identify this complete
  public id: string
  public results: CompleteResult[] | null
  public finished: boolean
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
    this.finished = false
  }

  public resuable(complete: Complete):boolean {
    let {id, col, colnr, input, line, linenr} = complete
    let same = id !== this.id
    if (!id
      || id !== this.id
      || !this.results
      || linenr !== this.linenr
      || colnr < this.colnr
      || !input.startsWith(this.input)
      || line.slice(0, col) !== this.line.slice(0, col)
      || col !== this.col) return false
    let buf = buffers.getBuffer(this.bufnr.toString())
    if (!buf) return false
    let more = line.slice(col)
    return buf.isWord(more)
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

  public filterResults(results: CompleteResult[], input: string, cword: string, isResume: boolean):VimCompleteItem[] {
    let arr: VimCompleteItem[] = []
    let {fuzzy} = this
    let cFirst = input.length ? input[0].toLowerCase() : null
    let filter = fuzzy ? filterFuzzy : filterWord
    let icase = !/[A-Z]/.test(input)
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      if (res == null) continue
      let {items, offsetLeft, offsetRight} = res
      let hasOffset = !!offsetLeft || !!offsetRight
      let user_data =  hasOffset ? JSON.stringify({
        offsetLeft: offsetLeft || 0,
        offsetRight: offsetRight || 0
      }) : null
      for (let item of items) {
        let {word, kind, info} = item
        if (!word || word.length <= 2) continue
        let first = word[0].toLowerCase()
        // first must match for no kind
        if (!kind && cFirst && cFirst !== first) continue
        if (!kind && input.length == 0) continue
        // filter unnecessary no kind results
        if (!kind && !isResume && (word == cword || word == input)) continue
        if (input.length && !filter(input, word, icase)) continue
        if (user_data) item.user_data = user_data
        if (fuzzy) item.score = score(word, input) + (kind || info ? 0.01 : 0)
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
    return uniqueItems(arr)
  }

  public async doComplete(sources: Source[]): Promise<VimCompleteItem[]> {
    let {id} = this
    if (id == null) return [] as VimCompleteItem[]
    let opts:CompleteOption = {
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
    valids.sort((a, b) => b.priority - a.priority)
    let engrossIdx = valids.findIndex(s => s.engross === true)
    logger.debug(`Working sources: ${valids.map(s => s.name).join(',')}`)
    let results = await Promise.all(valids.map(s => this.completeSource(s, opts)))
    this.finished = results.indexOf(null) == -1
    results = results.filter(r => r != null)
    if (engrossIdx && results[engrossIdx]) {
      let {items} = results[engrossIdx]
      if (items.length) results = [results[engrossIdx]]
    }
    // reuse it even it's bad
    this.results = results
    let {input, word} = this
    return this.filterResults(results, input, word, false)
  }
}
