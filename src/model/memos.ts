import fs from 'fs'
import { Memento } from '../types'
import { readFile, statAsync } from '../util/fs'
import { deepClone } from '../util/object'
const logger = require('../util/logger')('model-memos')

export default class Memos {
  constructor(private filepath: string) {
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, '{}', 'utf8')
    }
  }

  private fetchContent(id: string, key: string): any {
    try {
      let content = fs.readFileSync(this.filepath, 'utf8')
      let res = JSON.parse(content)
      let obj = res[id]
      if (!obj) return undefined
      return obj[key]
    } catch (e) {
      return undefined
    }
  }

  private async update(id: string, key: string, value: any): Promise<void> {
    let { filepath } = this
    // logger.debug('update:', key, JSON.stringify(value, null, 2))
    let content = fs.readFileSync(filepath, 'utf8')
    let current = JSON.parse(content)
    current[id] = current[id] || {}
    if (value !== undefined) {
      current[id][key] = deepClone(value)
    } else {
      delete current[id][key]
    }
    content = JSON.stringify(current, null, 2)
    fs.writeFileSync(filepath, content, 'utf8')
  }

  public createMemento(id: string): Memento {
    return {
      get: <T>(key: string, defaultValue?: T): T | undefined => {
        let res = this.fetchContent(id, key)
        return res === undefined ? defaultValue : res
      },
      update: async (key: string, value: any): Promise<void> => {
        await this.update(id, key, value)
      }
    }
  }
}
