import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import {statAsync} from '../util/fs'
import * as fs from 'fs'
import pify = require('pify')
const logger = require('../util/logger')('source-dictionary')

interface Dicts {
  [index: string] : string[]
}

let dicts:Dicts = {}

export default class Dictionary extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'dictionary',
      shortcut: 'D',
      priority: 1,
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {input} = opt
    if (input.length === 0) return false
    if (!this.checkFileType(opt.filetype)) return false
    let dictOption: string = await this.nvim.call('getbufvar', ['%', '&dictionary'])
    dictOption = opt.dictOption = dictOption.trim()
    if (!dictOption) return false
    return true
  }

  public async refresh():Promise<void> {
    dicts = {}
    let dictOption: string = await this.nvim.call('getbufvar', ['%', '&dictionary'])
    if (!dictOption) return
    let files = dictOption.split(',')
    await this.getWords(files)
    logger.info('dict refreshed')
  }

  public async getWords(files: string[]):Promise<string[]> {
    if (files.length == 0) return []
    let arr = await Promise.all(files.map(file => this.getDictWords(file)))
    let res = []
    for (let words of arr) {
      for (let word of words) {
        if (res.indexOf(word) === -1) {
          res.push(word)
        }
      }
    }
    return res
  }

  private async getDictWords(file: string):Promise<string[]> {
    if (!file) return []
    let words = dicts[file] || null
    if (words && words.length) return words
    let stat = await statAsync(file)
    if (!stat || !stat.isFile()) return []
    try {
      let content = await pify(fs.readFile)(file, 'utf8')
      words = content.split('\n')
    } catch (e) {
      logger.error(`Can't read file: ${file}`)
    }
    dicts[file] = words
    return words
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {dictOption} = opt
    let words = []
    if (dictOption) {
      let files = dictOption.split(',')
      words = await this.getWords(files)
      words = this.filterWords(words, opt)
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
