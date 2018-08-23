import fs from 'fs'
import path from 'path'
import pify from 'pify'
import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import workspace from '../workspace'
// const logger = require('../util/logger')('source-word')

let words = null

export default class Word extends Source {
  constructor() {
    super({
      name: 'word',
      filepath: __filename
    })
  }

  public async shouldComplete(opt: CompleteOption): Promise<boolean> {
    let { input } = opt
    if (input.length === 0) return false
    return true
  }

  public async doComplete(opt: CompleteOption): Promise<CompleteResult> {
    let file = path.resolve(workspace.pluginRoot, 'data/10k.txt')
    if (!fs.existsSync(file)) return
    if (!words) {
      let content = await pify(fs.readFile)(file, 'utf8')
      words = content.split(/\n/)
    }
    let list = this.filterWords(words, opt)
    return {
      items: list.map(word => {
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
