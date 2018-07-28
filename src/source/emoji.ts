import {Neovim} from '@chemzqm/neovim'
import Source from '../model/source'
import workspace from '../workspace'
import {CompleteOption, CompleteResult, SourceConfig} from '../types'
import fs from 'fs'
import path from 'path'
import pify from 'pify'
const logger = require('../util/logger')('source-emoji')

export interface Item {
  description: string
  character: string
}
let items: Item[] | null = null

export default class Emoji extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'emoji',
      ...opts,
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype, line} = opt
    if (!this.checkFileType(filetype)) return false
    let {col} = opt
    if (line[col] === ':') {
      opt.startcol = col
      return true
    } else if (line[col - 1] === ':') {
      opt.startcol = col - 1
      return true
    }
    return false
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let file = path.resolve(workspace.pluginRoot, 'data/emoji.txt')
    if (!fs.existsSync(file)) return
    let {input, startcol} = opt
    if (!items) {
      let content = await pify(fs.readFile)(file, 'utf8')
      let lines = content.split(/\n/)
      items = lines.map(str => {
        let parts = str.split(':')
        return {description: parts[0], character: parts[1]}
      })
    }
    let ch = input[0]
    let res = items.filter(o => {
      if (!ch) return true
      return o.description.indexOf(ch) !== -1
    })
    return {
      startcol,
      items: res.map(o => {
        return {
          word: o.character,
          abbr: `${o.character} ${o.description}`,
          menu: this.menu,
          filterText: ':' + o.description,
        }
      })
    }
  }
}
