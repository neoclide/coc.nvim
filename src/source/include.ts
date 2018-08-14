import {Neovim} from '@chemzqm/neovim'
import path from 'path'
import pify from 'pify'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig, ISource} from '../types'
import workspace from '../workspace'
const exec = require('child_process').exec
const logger = require('../util/logger')('source-include')

export default class Include extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'include',
      ...opts
    })
  }

  private get command():Promise<string> {
    let {listFileCommand} = this.config
    if (listFileCommand) return Promise.resolve(listFileCommand)
    return this.nvim.call('coc#util#get_listfile_command')
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {nvim} = this
    let {input, bufnr} = opt
    let command = await this.command
    if (input.length == 0) return null
    let {trimSameExts} = this.config
    let fullpath = await nvim.call('coc#util#get_fullpath', bufnr)
    let items = []
    if (command) {
      let dir = workspace.root
      let ext = fullpath ? path.extname(path.basename(fullpath)) : ''
      if (dir) {
        let out = await pify(exec)(command, {
          cwd: dir
        })
        let files = out.split(/\r?\n/)
        items = files.map(file => {
          let ex = path.extname(path.basename(file))
          let trim = trimSameExts.indexOf(ext) !== -1 && ex === ext
          let filepath = path.join(dir, file)
          let word = fullpath ? path.relative(path.dirname(fullpath), filepath) : filepath
          if (!/^\./.test(word)) word = `./${word}`
          if (trim) word = word.slice(0, - ext.length)
          return {
            word,
            abbr: file,
            menu: this.menu,
            filterText: file
          }
        })
      }
    }
    return {
      items
    }
  }
}

export function regist(sourceMap:Map<string, ISource>):void {
  let {nvim} = workspace
  let config = workspace.getConfiguration('coc.source').get<SourceConfig>('include')
  sourceMap.set('include', new Include(nvim, config))
}
