import fs from 'fs'
import path from 'path'
import pify from 'pify'
import { Disposable } from 'vscode-languageserver-protocol'
import Source from '../model/source'
import { CompleteOption, CompleteResult, ISource } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('source-emoji')

export interface Item {
  description: string
  character: string
}
let items: Item[] | null = null

export default class Emoji extends Source {
  constructor() {
    super({
      name: 'emoji',
      filepath: __filename
    })
  }

  public async doComplete(_opt: CompleteOption): Promise<CompleteResult> {
    let file = path.resolve(workspace.pluginRoot, 'data/emoji.txt')
    if (!fs.existsSync(file)) return
    if (!items) {
      let content = await pify(fs.readFile)(file, 'utf8')
      let lines = content.split(/\n/).slice(0, -1)
      items = lines.map(str => {
        let parts = str.split(':')
        return { description: parts[0], character: parts[1] }
      })
    }
    return {
      items: items.map(o => {
        return {
          word: o.character,
          abbr: `${o.character} ${o.description}`,
          menu: this.menu,
          filterText: o.description,
        }
      })
    }
  }
}

export function regist(sourceMap: Map<string, ISource>): Disposable {
  sourceMap.set('emoji', new Emoji())
  return Disposable.create(() => {
    sourceMap.delete('emoji')
  })
}
