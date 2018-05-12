import { Neovim } from 'neovim'
import {CompleteOption,
  VimCompleteItem,
  CompleteResult} from '../types'
import Source from '../model/source'
import {statAsync} from '../util/fs'
import path = require('path')
import unique = require('array-unique')
import pify = require('pify')
import fs = require('fs')
const logger = require('../util/logger')('source-file')
let pathRe = /((\.\.\/)+|\.\/|([a-z0-9_.@()-]+)?\/)([a-z0-9_.@()-]+\/)*[a-z0-9_.@()-]*$/

// from current file  => src of current cwd => current cwd

export default class File extends Source {
  constructor(nvim: Neovim) {
    super(nvim, {
      name: 'file',
      shortcut: 'F',
      priority: 2,
      engross: 1,
    })
    this.config.trimSameExts = ['.ts', '.js']
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let {line, colnr, bufnr} = opt
    let part = line.slice(0, colnr - 1)
    if (!part) return false
    let ms = part.match(pathRe)
    if (ms) {
      opt.pathstr = ms[0]
      opt.fullpath = await this.nvim.call('coc#util#get_fullpath', [Number(bufnr)])
      logger.debug(opt.fullpath)
      opt.cwd = await this.nvim.call('getcwd', [])
    }
    return ms != null
  }

  private async getFileItem(root:string, filename:string):Promise<VimCompleteItem|null> {
    let f = path.join(root, filename)
    let stat = await statAsync(f)
    if (stat) {
      return {
        word: filename + (stat.isDirectory() ? '/' : '')
      }
    }
    return null
  }

  public async getItemsFromRoots(pathstr: string, roots: string[]):Promise<VimCompleteItem[]> {
    let res = []
    let part = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr)
    for (let root of roots) {
      let dir = path.join(root, part).replace(/\/$/, '')
      let stat = await statAsync(dir)
      if (stat && stat.isDirectory()) {
        let files = await pify(fs.readdir)(dir)
        files = files.filter(f => !/^\./.test(f))
        let items = await Promise.all(files.map(filename => {
          return this.getFileItem(dir, filename)
        }))
        res = res.concat(items)
      }
    }
    res = res.filter(item => item != null)
    return res
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {pathstr, fullpath, cwd} = opt
    let roots = []
    if (/^\./.test(pathstr)) {
      roots = fullpath ? [path.dirname(fullpath)] : [path.join(cwd, 'src'), cwd ]
    } else if (/^\//.test(pathstr)) {
      roots = ['/']
    } else {
      roots = [path.join(cwd, 'src'), cwd ]
    }
    roots = roots.filter(r => r != null)
    roots = unique(roots)
    let items = await this.getItemsFromRoots(pathstr, roots)
    let ext = fullpath ? path.extname(path.basename(fullpath)) :''
    let trimExt = this.config.trimSameExts.indexOf(ext) != -1
    logger.debug(ext)
    return {
      items: items.map(item => {
        let ex = path.extname(item.word)
        item.word = trimExt && ex === ext ? item.word.replace(ext, '') : item.word
        return {
          ...item,
          menu: this.menu
        }
      })
    }
  }
}
