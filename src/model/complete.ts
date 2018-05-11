import {score} from 'fuzzaldrin'
import { Neovim } from 'neovim'
import {CompleteOption,
  VimCompleteItem,
  CompleteResult} from '../types'
import buffers from '../buffers'
import Source from './source'
import {getConfig} from '../config'
import {wordSortItems} from '../util/sorter'
import {equalChar} from '../util/index'
import {uniqueItems} from '../util/unique'
import {filterFuzzy, filterWord} from '../util/filter'
import Serial = require('node-serial')
const logger = require('../util/logger')('model-complete')

export type Callback = () => void

export default class Complete {
  // identify this complete
  public results: CompleteResult[] | null
  public option: CompleteOption
  constructor(opts: CompleteOption) {
    this.option = opts
  }

  public resuable(complete: Complete):boolean {
    let {col, colnr, input, line, linenr} = complete.option
    if (!this.results
      || linenr !== this.option.linenr
      || colnr < this.option.colnr
      || !input.startsWith(this.option.input)
      || line.slice(0, col) !== this.option.line.slice(0, col)
      || col !== this.option.col) return false
    let buf = buffers.getBuffer(this.option.bufnr.toString())
    if (!buf) return false
    let more = line.slice(col)
    return buf.isWord(more)
  }

  private completeSource(source: Source, opt: CompleteOption): Promise<any> {
    let {engross} = source
    let start = Date.now()
    let s = new Serial()
    // new option for each source
    let option = Object.assign({}, opt)
    s.timeout(Math.max(getConfig('timeout'), 300))
    s.add((done, ctx) => {
      source.shouldComplete(option).then(res => {
        ctx.shouldRun = res
        done()
      }, done)
    })
    s.add((done, ctx) => {
      if (!ctx.shouldRun) {
        logger.debug(`Source ${source.name} skipped`)
        return done()
      }
      source.doComplete(option).then(result => {
        if (engross
          && result != null
          && result.items
          && result.items.length) {
          result.engross = true
        }
        if (result == null) {
          result = {items: []}
        }
        result.source = source.name
        ctx.result = result
        done()
      }, done)
    })
    return new Promise(resolve => {
      s.done((err, ctx) => {
        if (err) {
          logger.error(`Complete error of source '${source.name}'`)
          logger.error(err.stack)
          resolve(false)
          return
        }
        if (ctx.result) {
          logger.info(`Complete '${source.name}' takes ${Date.now() - start}ms`)
        }
        resolve(ctx.result || null)
      })
    })
  }

  public filterResults(results: CompleteResult[], isResume: boolean):VimCompleteItem[] {
    let arr: VimCompleteItem[] = []
    let {input, id} = this.option
    let fuzzy = getConfig('fuzzyMatch')
    let filter = fuzzy ? filterFuzzy : filterWord
    let icase = !/[A-Z]/.test(input)
    for (let i = 0, l = results.length; i < l; i++) {
      let res = results[i]
      let {items} = res
      for (let item of items) {
        let {word, kind, info, user_data} = item
        let data = {}
        if (input.length && !filter(input, word, icase)) continue
        if (user_data) {
          try {
            data = JSON.parse(user_data)
          } catch (e) {} // tslint:disable-line
        }
        data = Object.assign(data, { cid: id })
        item.user_data = JSON.stringify(data)
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

  public async doComplete(sources: Source[]): Promise<[number, VimCompleteItem[]]> {
    let opts = this.option
    let {col} = opts
    sources.sort((a, b) => b.priority - a.priority)
    let results = await Promise.all(sources.map(s => this.completeSource(s, opts)))
    results = results.filter(r => {
      // error source
      if (r ===false) return false
      if (r == null) return false
      return r.items && r.items.length > 0
    })
    logger.debug(`Results from sources: ${results.map(s => s.source).join(',')}`)

    let engrossResult = results.find(r => r.engross === true)
    if (engrossResult) {
      if (engrossResult.startcol != null) {
        col = engrossResult.startcol
      }
      results = [engrossResult]
      logger.debug(`Engross source ${engrossResult.source} activted`)
    }
    logger.debug(`resultes: ${JSON.stringify(results)}`)
    // use it even it's bad
    this.results = results
    let filteredResults = this.filterResults(results, false)
    logger.debug(`Filtered items: ${JSON.stringify(filteredResults, null, 2)}`)
    return [col, filteredResults]
  }
}
