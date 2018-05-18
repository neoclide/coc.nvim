import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import {echoErr, echoWarning} from '../util/index'
const logger = require('../util/logger')('source-omni')

export default class OmniSource extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'omni',
      shortcut: 'O',
      priority: 3,
      filetypes: []
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype} = opt
    if (!this.checkFileType(filetype)) return false
    let func: string = await this.nvim.call('getbufvar', ['%', '&omnifunc'])
    opt.func = func
    if (typeof func == 'string' && func.length != 0) return true
    await echoWarning(this.nvim, 'omnifunc option is empty, omni source skipped')
    return false
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult|null> {
    let {line, colnr, col, func} = opt
    let {nvim} = this
    if (['LanguageClient#complete', 'jedi#completes'].indexOf('func') !== -1) {
      await echoWarning(nvim, `omnifunc ${func} is broken, skipped!`)
      return null
    }
    let startcol:number = col
    try {
      startcol = await nvim.call(func, [1, ''])
      startcol = Number(startcol)
    } catch (e) {
      await echoErr(nvim, `vim error from ${func} :${e.message}`)
      return null
    }
    // invalid startcol
    if (isNaN(startcol) || startcol < 0 || startcol > colnr) return null
    let text = line.slice(startcol, colnr)
    let words = await nvim.call(func, [0, text])
    if (words.hasOwnProperty('words')) {
      words = words.words
    }
    let res:CompleteResult = {
      items: this.convertToItems(words)
    }
    if (startcol !== col && words.length != 0) {
      res.startcol = startcol
      res.engross = true
    }
    return res
  }
}
