import {Neovim} from '@chemzqm/neovim'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig} from '../types'
import workspace from '../workspace'
import fs from 'fs'
import path from 'path'
import pify from 'pify'
// const logger = require('../util/logger')('source-word')

let words = null

export default class Word extends Source {
  constructor(nvim: Neovim, opts: SourceConfig) {
    super(nvim, {
      name: 'word',
      ...opts,
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let {input} = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let file = path.resolve(workspace.pluginRoot, 'data/10k.txt')
    if (!fs.existsSync(file)) return
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
