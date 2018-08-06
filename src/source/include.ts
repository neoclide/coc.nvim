import {Neovim} from '@chemzqm/neovim'
import path from 'path'
import pify from 'pify'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig} from '../types'
import {findSourceDir} from '../util/fs'
import {toNumber} from '../util/types'
const exec = require('child_process').exec
const logger = require('../util/logger')('source-include')

export default class Include extends Source {
  private command: string
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'include',
      ...opts
    })
  }

  public async onInit(): Promise<void> {
    let {listFileCommand} = this.config
    if (!listFileCommand) {
      this.command = await this.nvim.call('coc#util#get_listfile_command')
    } else {
      this.command = listFileCommand
    }
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {command, nvim} = this
    let {bufnr, input} = opt
    if (input.length == 0) return null
    let {trimSameExts} = this.config
    let fullpath = await nvim.call('coc#util#get_fullpath', [toNumber(bufnr)])
    let items = []
    if (fullpath && command) {
      let dir = findSourceDir(fullpath)
      let ext = path.extname(path.basename(fullpath))
      if (dir) {
        let out = await pify(exec)(command, {
          cwd: dir
        })
        let files = out.split(/\r?\n/)
        items = files.map(file => {
          let ex = path.extname(path.basename(file))
          let trim = trimSameExts.indexOf(ext) !== -1 && ex === ext
          let filepath = path.join(dir, file)
          let word = path.relative(path.dirname(fullpath), filepath)
          if (!/^\./.test(word)) word = `./${word}`
          if (trim) word = word.slice(0, - ext.length)
          return {
            word,
            abbr: file,
            menu: this.menu,
          }
        })
      }
    }
    return {
      items
    }
  }
}
