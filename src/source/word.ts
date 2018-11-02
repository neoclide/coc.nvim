import fs from 'fs'
import path from 'path'
import pify from 'pify'
import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('source-word')

let words = null

export default class Word extends Source {
  constructor() {
    super({
      name: 'word',
      filepath: __filename,
      isFallback: true
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let { input } = opt
    if (!/^[A-Za-z]{1,}$/.test(input)) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let file = path.resolve(workspace.pluginRoot, 'data/10k.txt')
    if (!fs.existsSync(file)) return
    if (!words) {
      let content = await pify(fs.readFile)(file, 'utf8')
      words = content.split(/\n/)
    }
    let first = opt.input[0]
    let list = words.filter(s => s[0] == first.toLowerCase())
    let code = first.charCodeAt(0)
    let upperCase = code <= 90 && code >= 65
    return {
      items: list.map(str => {
        let word = upperCase ? str[0].toUpperCase() + str.slice(1) : str
        return {
          word,
          menu: this.menu
        }
      })
    }
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('word', new Word())
  return Disposable.create(() => {
    sourceMap.delete('word')
  })
}
