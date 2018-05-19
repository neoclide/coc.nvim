import { Neovim } from 'neovim'
import {CompleteOption,
  VimCompleteItem,
  CompleteResult} from '../types'
import Source from '../model/source'
import {statAsync, findSourceDir} from '../util/fs'
import matcher = require('matcher')
import path = require('path')
import pify = require('pify')
import fs = require('fs')
const logger = require('../util/logger')('source-file')
let pathRe = /((\.\.\/)+|\.\/|([a-z0-9_.@()-]+)?\/)([a-z0-9_.@()-]+\/)*[a-z0-9_.@()-]*$/

export default class File extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'file',
      shortcut: 'F',
      priority: 2,
      engross: 1,
      trimSameExts: ['.ts', '.js'],
      ignoreHidden: true,
      ignorePatterns: [],
      noinsert: true,
    })
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let {line, colnr, bufnr} = opt
    let part = line.slice(0, colnr - 1)
    if (!part) return false
    let ms = part.match(pathRe)
    if (ms) {
      opt.pathstr = ms[0]
      let fullpath = opt.fullpath = await this.nvim.call('coc#util#get_fullpath', [Number(bufnr)])
      opt.cwd = await this.nvim.call('getcwd', [])
      opt.ext = fullpath ? path.extname(path.basename(fullpath)) :''
      return true
    }
    return false
  }

  private async getFileItem(root:string, filename:string, ext:string, trimExt:boolean):Promise<VimCompleteItem|null> {
    let f = path.join(root, filename)
    let stat = await statAsync(f)
    if (stat) {
      let trim = trimExt && ext == path.extname(filename)
      let abbr = stat.isDirectory() ? filename + '/' : filename
      let word = trim ? filename.slice(0, - ext.length) : filename
      word = stat.isDirectory() ? word + '/' : word
      return { word, abbr }
    }
    return null
  }

  public filterFiles(files:string[]):string[] {
    let {ignoreHidden, ignorePatterns} = this.config
    return files.filter(f => {
      if (f == null) return false
      if (ignoreHidden && /^\./.test(f)) return false
      for (let p of ignorePatterns) {
        if (matcher.isMatch(f, p)) return false
      }
      return true
    })
  }

  public async getItemsFromRoots(pathstr: string, roots: string[], ext:string):Promise<VimCompleteItem[]> {
    let res = []
    let trimExt = (this.config.trimSameExts || []).indexOf(ext) != -1
    let part = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr)
    for (let root of roots) {
      let dir = path.join(root, part).replace(/\/$/, '')
      let stat = await statAsync(dir)
      if (stat && stat.isDirectory()) {
        let files = await pify(fs.readdir)(dir)
        files = this.filterFiles(files)
        let items = await Promise.all(files.map(filename => {
          return this.getFileItem(dir, filename, ext, trimExt)
        }))
        res = res.concat(items)
      }
    }
    res = res.filter(item => item != null)
    return res
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {pathstr, fullpath, cwd, ext, colnr} = opt

    let line = await this.nvim.call('getline', ['.'])
    let noSlash = line[colnr - 1] === '/'
    let roots = []
    if (!fullpath) {
      roots = [path.join(cwd, 'src'), cwd]
    } else if (/^\./.test(pathstr)) {
      roots = [path.dirname(fullpath)]
    } else if (/^\//.test(pathstr)) {
      roots = ['/']
    } else {
      roots = [findSourceDir(fullpath) || cwd]
    }
    roots = roots.filter(r => typeof r === 'string')
    let items = await this.getItemsFromRoots(pathstr, roots, ext)
    let trimExt = this.config.trimSameExts.indexOf(ext) != -1
    return {
      items: items.map(item => {
        let ex = path.extname(item.word)
        item.word = trimExt && ex === ext ? item.word.replace(ext, '') : item.word
        if (noSlash) item.word = item.word.replace(/\/$/, '')
        return {
          ...item,
          menu: this.menu
        }
      })
    }
  }
}
