import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import {logger} from '../util/logger'
import buffers from '../buffers'
import * as fs from 'fs'
import unique = require('array-unique')
import pify = require('pify')

interface Dicts {
  [index: string] : string[]
}

export default class Dictionary extends Source {
  private dicts: Dicts
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'dictionary',
      shortcut: 'D',
      priority: 1,
    })
    this.dicts = {}
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async refresh():Promise<void> {
    this.dicts = {}
  }

  public async getWords(dicts: string[]):Promise<string[]> {
    if (dicts.length == 0) return []
    let arr = await Promise.all(dicts.map(dict => this.getDictWords(dict)))
    return unique([].concat.apply([], arr))
  }

  private async getDictWords(file: string):Promise<string[]> {
    let res = this.dicts[file]
    if (res) return res
    let words = []
    try {
      let content = await pify(fs.readFile)(file, 'utf8')
      words = content.split('\n')
    } catch (e) {
      logger.error(`Can't read file: ${file}`)
    }
    this.dicts[file] = words
    return words
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr, input, filetype} = opt
    let dictOption = await this.nvim.call('getbufvar', [Number(bufnr), '&dictionary'])
    let dicts = dictOption.split(',')
    let words = await this.getWords(dicts)
    return {
      items: words.map(word => {
        return {
          word,
          menu: this.menu
        }
      })
    }
  }
}
