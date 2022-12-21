'use strict'
import { CompletionItemKind } from 'vscode-languageserver-types'
import { statAsync } from '../../util/fs'
import { fs, minimatch, path, promisify } from '../../util/node'
import { isWindows } from '../../util/platform'
import { CancellationToken } from '../../util/protocol'
import { byteSlice } from '../../util/string'
import workspace from '../../workspace'
import Source from '../source'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource, VimCompleteItem } from '../types'
const pathRe = /(?:\.{0,2}|~|\$HOME|([\w]+)|[a-zA-Z]:|)(\/|\\+)(?:[\u4E00-\u9FA5\u00A0-\u024F\w .@()-]+(\/|\\+))*(?:[\u4E00-\u9FA5\u00A0-\u024F\w .@()-])*$/

interface PathOption {
  pathstr: string
  part: string
  startcol: number
  input: string
}

export function resolveEnvVariables(str: string, env = process.env): string {
  let replaced = str
  // windows
  replaced = replaced.replace(/%([^%]+)%/g, (m, n) => env[n] ?? m)
  // linux and mac
  replaced = replaced.replace(
    /\$([A-Z_]+[A-Z0-9_]*)|\${([A-Z0-9_]*)}/gi,
    (m, a, b) => (env[a || b] ?? m)
  )
  return replaced
}

export async function getFileItem(root: string, filename: string): Promise<VimCompleteItem | null> {
  let f = path.join(root, filename)
  let stat = await statAsync(f)
  if (stat) {
    let dir = stat.isDirectory()
    let abbr = dir ? filename + '/' : filename
    let word = filename
    return { word, abbr, kind: dir ? CompletionItemKind.Folder : CompletionItemKind.File }
  }
  return null
}

export function filterFiles(files: string[], ignoreHidden: boolean, ignorePatterns: string[] = []): string[] {
  return files.filter(f => {
    if (!f || (ignoreHidden && f.startsWith("."))) return false
    for (let p of ignorePatterns) {
      if (minimatch(f, p, { dot: true })) return false
    }
    return true
  })
}

export function getDirectory(pathstr: string, root: string): string {
  let part = /[\\/]$/.test(pathstr) ? pathstr : path.dirname(pathstr)
  return path.isAbsolute(pathstr) ? part : path.join(root, part)
}

export async function getItemsFromRoot(pathstr: string, root: string, ignoreHidden: boolean, ignorePatterns: string[]): Promise<VimCompleteItem[]> {
  let res = []
  let dir = getDirectory(pathstr, root)
  let stat = await statAsync(dir)
  if (stat && stat.isDirectory()) {
    let files = await promisify(fs.readdir)(dir)
    files = filterFiles(files, ignoreHidden, ignorePatterns)
    let items = await Promise.all(files.map(filename => getFileItem(dir, filename)))
    res = res.concat(items)
  }
  res = res.filter(item => item != null)
  return res
}

export class File extends Source {
  constructor(public isWindows: boolean) {
    super({
      name: 'file',
      filepath: __filename
    })
  }

  public get triggerCharacters(): string[] {
    let characters = this.getConfig('triggerCharacters', [])
    return this.isWindows ? characters : characters.filter(s => s != '\\')
  }

  private getPathOption(opt: CompleteOption): PathOption | null {
    let { line, colnr } = opt
    let part = byteSlice(line, 0, colnr - 1)
    part = resolveEnvVariables(part)
    if (!part || part.endsWith('//')) return null
    let ms = part.match(pathRe)
    if (ms && ms.length) {
      const pathstr = workspace.expand(ms[0])
      let input = ms[0].match(/[^/\\]*$/)[0]
      return { pathstr, part: ms[1], startcol: colnr - input.length - 1, input }
    }
    return null
  }

  public shouldTrim(ext: string): boolean {
    let trimSameExts = this.getConfig('trimSameExts', [])
    return trimSameExts.includes(ext)
  }

  public async getRoot(pathstr: string, part: string, filepath: string, cwd: string): Promise<string | undefined> {
    let root: string | undefined
    let dirname = filepath ? path.dirname(filepath) : ''
    if (pathstr.startsWith(".")) {
      root = filepath ? dirname : cwd
    } else if (this.isWindows && /^\w+:/.test(pathstr)) {
      root = /[\\/]$/.test(pathstr) ? pathstr : path.win32.dirname(pathstr)
    } else if (!this.isWindows && pathstr.startsWith("/")) {
      root = pathstr.endsWith("/") ? pathstr : path.posix.dirname(pathstr)
    } else if (part) {
      let exists = await promisify(fs.exists)(path.join(dirname, part))
      if (exists) {
        root = dirname
      } else {
        exists = await promisify(fs.exists)(path.join(cwd, part))
        if (exists) root = cwd
      }
    } else {
      root = cwd
    }
    return root
  }

  public async doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult<ExtendedCompleteItem>> {
    let { filepath } = opt
    let option = this.getPathOption(opt)
    if (!option || option.startcol < opt.col) return null
    let { pathstr, part, startcol } = option
    let startPart = opt.col == startcol ? '' : byteSlice(opt.line, opt.col, startcol)
    let ext = path.extname(path.basename(filepath))
    let cwd = await this.nvim.call('getcwd', []) as string
    let root = await this.getRoot(pathstr, part, filepath, cwd)
    if (!root || token.isCancellationRequested) return null
    let items = await getItemsFromRoot(pathstr, root, this.getConfig('ignoreHidden', true), this.getConfig('ignorePatterns', []))
    let trimExt = this.shouldTrim(ext)
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

export function register(sourceMap: Map<string, ISource>): void {
  sourceMap.set('file', new File(isWindows))
}
