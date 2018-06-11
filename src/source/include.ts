import { Neovim } from 'neovim'
import {CompleteOption, CompleteResult} from '../types'
import Source from '../model/source'
import * as fs from 'fs'
import {findSourceDir} from '../util/fs'
import {toNumber} from '../util/types'
import path = require('path')
import pify = require('pify')
const exec = require('child_process').exec
const logger = require('../util/logger')('source-include')
const baseDir = path.join(__dirname, 'include_resolve')

export default class Include extends Source {
  private command:string
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'include',
      shortcut: 'I',
      priority: 10,
      filetypes: [],
      trimSameExts: ['.ts', '.js'],
    })
  }

  public async onInit(): Promise<void> {
    let files = await pify(fs.readdir)(baseDir)
    files = files.filter(f => /\.js$/.test(f))
    let filetypes = files.map(f => f.replace(/\.js$/, ''))
    this.config.filetypes = filetypes
    this.command = await this.nvim.call('coc#util#get_listfile_command')
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {filetype} = opt
    if (!this.checkFileType(filetype)) return false
    let {shouldResolve} = require(path.join(baseDir, filetype))
    return await shouldResolve(opt)
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {command, nvim} = this
    let {bufnr, col} = opt
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
            menu: this.menu
          }
        })
      }
    }
    return {
      startcol: col - 1,
      items
    }
  }
}
