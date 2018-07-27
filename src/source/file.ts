import fs from 'fs'
import {Neovim} from '@chemzqm/neovim'
import path from 'path'
import pify from 'pify'
import minimatch from 'minimatch'
import Source from '../model/source'
import {CompleteOption, CompleteResult, SourceConfig, VimCompleteItem} from '../types'
import {statAsync} from '../util/fs'
import {byteSlice} from '../util/string'
const pathRe = /\.{0,2}\/(?:[\w.@()-]+\/)*(?:[\w.@()-])*$/

export default class File extends Source {
  constructor(nvim: Neovim, opts: Partial<SourceConfig>) {
    super(nvim, {
      name: 'file',
      ...opts
    })
  }
  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    if (!this.checkFileType(opt.filetype)) return false
    let {line, linenr, colnr, bufnr} = opt
    if (opt.triggerCharacter == '/') {
      let synName = await this.nvim.call('coc#util#get_syntax_name', [linenr, colnr - 1]) as string
      synName = synName.toLowerCase()
      if (synName && ['string', 'comment'].indexOf(synName) == -1) {
        return false
      }
    }
    let part = byteSlice(line, 0, colnr - 1)
    if (!part || part.slice(-2) == '//') return false
    let ms = part.match(pathRe)
    if (ms) {
      opt.pathstr = ms[0]
      let fullpath = opt.fullpath = await this.nvim.call('coc#util#get_fullpath', [bufnr])
      opt.cwd = await this.nvim.call('getcwd', [])
      opt.ext = fullpath ? path.extname(path.basename(fullpath)) : ''
      return true
    }
    return false
  }

  private async getFileItem(root: string, filename: string): Promise<VimCompleteItem | null> {
    let f = path.join(root, filename)
    let stat = await statAsync(f)
    if (stat) {
      let abbr = stat.isDirectory() ? filename + '/' : filename
      let word = filename
      return {word, abbr}
    }
    return null
  }

  public filterFiles(files: string[]): string[] {
    let {ignoreHidden, ignorePatterns} = this.config
    return files.filter(f => {
      if (f == null) return false
      if (ignoreHidden && /^\./.test(f)) return false
      for (let p of ignorePatterns) {
        if (minimatch(f, p)) return false
      }
      return true
    })
  }

  public async getItemsFromRoot(pathstr: string, root: string): Promise<VimCompleteItem[]> {
    let res = []
    let part = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr)
    let dir = path.isAbsolute(pathstr) ? root : path.join(root, part)
    let stat = await statAsync(dir)
    if (stat && stat.isDirectory()) {
      let files = await pify(fs.readdir)(dir)
      files = this.filterFiles(files)
      let items = await Promise.all(files.map(filename => {
        return this.getFileItem(dir, filename)
      }))
      res = res.concat(items)
    }
    res = res.filter(item => item != null)
    return res
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let {input, pathstr, col, cwd, ext, fullpath} = opt
    let root
    if (/^\./.test(pathstr)) {
      root = fullpath ? path.dirname(fullpath) : cwd
    } else if (/^\//.test(pathstr)) {
      root = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr)
    } else {
      root = cwd
    }
    let items = await this.getItemsFromRoot(pathstr, root)
    let trimExt = this.config.trimSameExts.indexOf(ext) != -1
    let startcol = this.fixStartcol(opt, ['-', '@'])
    let first = input[0]
    if (first && col == startcol) items = items.filter(o => o.word[0] === first)
    return {
      startcol,
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
