import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import {statAsync} from '../util/fs'
import Source from '../model/source'
import buffers from '../buffers'
import fs = require('fs')
import path = require('path')
import pify = require('pify')
const logger = require('../util/logger')('source-word')

let words = null
let file = path.resolve(__dirname, '../../data/10k.txt')

export default class Word extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'word',
      shortcut: '10k',
      priority: 0,
      filetypes: [],
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let stat = await statAsync(file)
    if (!stat || !stat.isFile()) return false
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    if (!words) {
      let content = await pify(fs.readFile)(file, 'utf8')
      words = content.split(/\n/)
    }
    let list = this.filterWords(words, opt)
    return {
      items: list.map(word => {
        return {
          word,
          menu: this.menu
        }
      })
    }
  }
}
