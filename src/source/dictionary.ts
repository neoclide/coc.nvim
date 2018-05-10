import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import {logger} from '../util/logger'
import {statAsync} from '../util/fs'
import buffers from '../buffers'
import * as fs from 'fs'
import unique = require('array-unique')
import pify = require('pify')

interface Dicts {
  [index: string] : string[]
}

export default class Dictionary extends Source {
  private dicts: Dicts | null
  private dictOption: string
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'dictionary',
      shortcut: 'D',
      priority: 1,
    })
    this.dicts = null
    this.dictOption = ''
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input, bufnr} = opt
    if (input.length === 0) return false
    let dictOption: string = await this.nvim.call('getbufvar', [Number(bufnr), '&dictionary'])
    dictOption = this.dictOption = dictOption.trim()
    if (!dictOption) return false
    return true
  }

  public async refresh():Promise<void> {
    this.dicts = null
    let dictOption: string = await this.nvim.call('getbufvar', ['%', '&dictionary'])
    if (!dictOption) return
    let files = dictOption.split(',')
    await this.getWords(files)
    logger.info('dict refreshed')
  }

  public async getWords(files: string[]):Promise<string[]> {
    if (files.length == 0) return []
    let arr = await Promise.all(files.map(file => this.getDictWords(file)))
    return unique([].concat.apply([], arr))
  }

  private async getDictWords(file: string):Promise<string[]> {
    if (!file) return []
    let {dicts} = this
    let words = dicts ? dicts[file] : []
    if (words) return words
    let stat = await statAsync(file)
    if (!stat || !stat.isFile()) return []
    try {
      let content = await pify(fs.readFile)(file, 'utf8')
      words = content.split('\n')
    } catch (e) {
      logger.error(`Can't read file: ${file}`)
    }
    this.dicts = this.dicts || {}
    this.dicts[file] = words
    return words
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {bufnr, input, filetype} = opt
    let {dictOption} = this
    let words = []
    if (dictOption) {
      let dicts = dictOption.split(',')
      words = await this.getWords(dicts)
    }
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
