import {Neovim} from '@chemzqm/neovim'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig, ISource} from '../types'
import {echoErr, echoMessage} from '../util/index'
import {byteSlice} from '../util/string'
import workspace from '../workspace'
const logger = require('../util/logger')('source-omni')

export default class OmniSource extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'omni',
      ...opts
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let func: string = await this.nvim.call('getbufvar', ['%', '&omnifunc'])
    opt.func = func
    if (typeof func == 'string' && func.length != 0) return true
    echoMessage(this.nvim, 'omnifunc option is empty, omni source skipped')
    return false
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult | null> {
    let {line, colnr, col, func} = opt
    let {nvim} = this
    if (['LanguageClient#complete'].indexOf('func') !== -1) {
      echoMessage(nvim, `omnifunc ${func} is broken, skipped!`)
      return null
    }
    let startcol: number = col
    try {
      startcol = await nvim.call(func, [1, ''])
      startcol = Number(startcol)
    } catch (e) {
      echoErr(nvim, `vim error from ${func} :${e.message}`)
      return null
    }
    // invalid startcol
    if (isNaN(startcol) || startcol < 0 || startcol > colnr) return null
    let text = byteSlice(line, startcol, colnr)
    let words = await nvim.call(func, [0, text])
    if (words.hasOwnProperty('words')) {
      words = words.words
    }
    let res: CompleteResult = {
      items: this.convertToItems(words)
    }
    if (startcol && startcol !== col && words.length != 0) {
      res.startcol = startcol
      res.engross = true
    }
    return res
  }
}

export function regist(sourceMap:Map<string, ISource>):void {
  let {nvim} = workspace
  let config = workspace.getConfiguration('coc.source').get<SourceConfig>('omni')
  sourceMap.set('omni', new OmniSource(nvim, config))
}
