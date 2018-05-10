import { Neovim } from 'neovim'
import {CompleteOption, VimCompleteItem, CompleteResult} from '../types'
import Source from '../model/source'
import {logger} from '../util/logger'
import {echoWarning} from '../util/index'
import * as fs from 'fs'
import path = require('path')
import pify = require('pify')

export default class OmniSource extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'omni',
      shortcut: 'O',
      priority: 3,
      filetypes: []
    })
  }

  public async onInit(): Promise<void> {
    let res = await this.nvim.getVar('complete_omni_filetypes')
    if (Array.isArray(res)) {
      this.filetypes = res
    }
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype} = opt
    if (!this.filetypes) return false
    if (this.filetypes.indexOf(filetype) === -1) return false
    let func: string = await this.nvim.call('getbufvar', ['%', '&omnifunc'])
    return typeof func == 'string' && func.length != 0
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {line, colnr, col} = opt
    let func: string = await this.nvim.call('getbufvar', ['%', '&omnifunc'])
    if (['LanguageClient#complete'].indexOf('func') !== -1) {
      echoWarning(this.nvim, `omnifunc ${func} is broken, skipped!`)
      return {items: []}
    }
    let startcol: number = await this.nvim.call(func, [1, ''])
    startcol = Number(startcol)
    // invalid startcol
    if (isNaN(startcol) || startcol < 0 || startcol > colnr) return null
    let text = line.slice(startcol, colnr)
    let words = await this.nvim.call(func, [0, text])
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
