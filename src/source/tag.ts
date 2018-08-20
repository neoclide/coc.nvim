import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import { readFileByLine, statAsync } from '../util/fs'
import path = require('path')
const logger = require('../util/logger')('source-tag')

export interface CacheItem {
  mtime: Date
  words: Set<string>
}

let TAG_CACHE: { [index: string]: CacheItem } = {}

export default class Tag extends Source {
  constructor() {
    super({
      name: 'tag',
      filepath: __filename
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let files = await this.nvim.call('tagfiles')
    let cwd = await this.nvim.call('getcwd')
    files = files.map(f => {
      return path.isAbsolute(f) ? f : path.join(cwd, f)
    })
    let tagfiles = []
    for (let file of files) {
      let stat = await statAsync(file)
      if (!stat || !stat.isFile()) continue
      tagfiles.push({ file, mtime: stat.mtime })
    }
    if (tagfiles.length === 0) return false
    opt.tagfiles = tagfiles
    return true
  }

  public async refresh(): Promise<void> {
    TAG_CACHE = {}
  }

  private async loadTags(fullpath: string, mtime: Date): Promise<Set<string>> {
    let item: CacheItem = TAG_CACHE[fullpath]
    if (item && item.mtime >= mtime) return item.words
    let words: Set<string> = new Set()
    await readFileByLine(fullpath, line => {
      if (line[0] == '!') return
      let ms = line.match(/^[^\t\s]+/)
      let w = ms ? ms[0] : null
      if (w && w.length > 2) words.add(w)
    })
    TAG_CACHE[fullpath] = { words, mtime }
    return words
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let { tagfiles, input } = opt
    if (input.length == 0) return null
    let list = await Promise.all(tagfiles.map(o => this.loadTags(o.file, o.mtime)))
    let allWords: Set<string> = new Set()
    for (let words of list as any) {
      for (let word of words.values()) {
        allWords.add(word)
      }
    }
    let words = Array.from(allWords.values())
    words = words.filter(s => input[0] == s[0])
    return {
      items: words.map(word => {
        return {
          word,
          menu: this.menu
        }
      })
    }
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('tag', new Tag())
  return Disposable.create(() => {
    sourceMap.delete('tag')
  })
}
