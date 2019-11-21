import fs from 'fs'
import minimatch from 'minimatch'
import os from 'os'
import path from 'path'
import util from 'util'
import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource, VimCompleteItem } from '../types'
import { statAsync } from '../util/fs'
import { byteSlice } from '../util/string'
const logger = require('../util/logger')('source-file')
const pathRe = /(?:\.{0,2}|~|\$HOME|([\w]+)|)\/(?:[\w.@()-]+\/)*(?:[\w.@()-])*$/

interface PathOption {
  pathstr: string
  part: string
  startcol: number
  input: string
}

export default class File extends Source {
  constructor() {
    super({
      name: 'file',
      filepath: __filename
    })
  }

  private getPathOption(opt: CompleteOption): PathOption | null {
    let { line, colnr } = opt
    let part = byteSlice(line, 0, colnr - 1)
    if (!part || part.slice(-2) == '//') return null
    let ms = part.match(pathRe)
    if (ms && ms.length) {
      let pathstr = ms[0]
      if (pathstr.startsWith('~')) {
        pathstr = os.homedir() + pathstr.slice(1)
      }
      if (pathstr.startsWith('$HOME')) {
        pathstr = os.homedir() + pathstr.slice(5)
      }
      let input = ms[0].match(/[^/]*$/)[0]
      return { pathstr, part: ms[1], startcol: colnr - input.length - 1, input }
    }
    return null
  }

  private async getFileItem(root: string, filename: string): Promise<VimCompleteItem | null> {
    let f = path.join(root, filename)
    let stat = await statAsync(f)
    if (stat) {
      let abbr = stat.isDirectory() ? filename + '/' : filename
      let word = filename
      return { word, abbr }
    }
    return null
  }

  public filterFiles(files: string[]): string[] {
    let ignoreHidden = this.getConfig('ignoreHidden', true)
    let ignorePatterns = this.getConfig('ignorePatterns', [])
    return files.filter(f => {
      if (f == null) return false
      if (ignoreHidden && /^\./.test(f)) return false
      for (let p of ignorePatterns) {
        if (minimatch(f, p, { dot: true })) return false
      }
      return true
    })
  }

  public async getItemsFromRoot(pathstr: string, root: string): Promise<VimCompleteItem[]> {
    let res = []
    let part = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr)
    let dir = path.isAbsolute(pathstr) ? part : path.join(root, part)
    let stat = await statAsync(dir)
    if (stat && stat.isDirectory()) {
      let files = await util.promisify(fs.readdir)(dir)
      files = this.filterFiles(files)
      let items = await Promise.all(files.map(filename => {
        return this.getFileItem(dir, filename)
      }))
      res = res.concat(items)
    }
    res = res.filter(item => item != null)
    return res
  }

  public get trimSameExts(): string[] {
    return this.getConfig('trimSameExts', [])
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { col, filepath } = opt
    let option = this.getPathOption(opt)
    if (!option) return null
    let { pathstr, part, startcol, input } = option
    if (startcol < opt.col) return null
    let startPart = opt.col == startcol ? '' : byteSlice(opt.line, opt.col, startcol)
    let dirname = path.dirname(filepath)
    let ext = path.extname(path.basename(filepath))
    let cwd = await this.nvim.call('getcwd', [])
    let root
    if (/^\./.test(pathstr)) {
      root = filepath ? path.dirname(filepath) : cwd
    } else if (/^\//.test(pathstr)) {
      root = /\/$/.test(pathstr) ? pathstr : path.dirname(pathstr)
    } else if (part) {
      if (fs.existsSync(path.join(dirname, part))) {
        root = dirname
      } else if (fs.existsSync(path.join(cwd, part))) {
        root = cwd
      }
    } else {
      root = cwd
    }
    if (!root) return null
    let items = await this.getItemsFromRoot(pathstr, root)
    let trimExt = this.trimSameExts.indexOf(ext) != -1
    let first = input[0]
    if (first && col == startcol) items = items.filter(o => o.word[0] === first)
    return {
      items: items.map(item => {
        let ex = path.extname(item.word)
        item.word = trimExt && ex === ext ? item.word.replace(ext, '') : item.word
        return {
          word: `${startPart}${item.word}`,
          abbr: `${startPart}${item.abbr}`,
          menu: this.menu
        }
      })
    }
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('file', new File())
  return Disposable.create(() => {
    sourceMap.delete('file')
  })
}
