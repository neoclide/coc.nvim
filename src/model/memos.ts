'use strict'
import { loadJson, writeJson } from '../util/fs'
import { fs } from '../util/node'
import { deepClone } from '../util/object'

/**
 * A memento represents a storage utility. It can store and retrieve
 * values.
 */
export interface Memento {
  get<T>(key: string): T | undefined
  get<T>(key: string, defaultValue: T): T
  update(key: string, value: any): Promise<void>
}

export default class Memos {
  constructor(private filepath: string) {
    if (!fs.existsSync(filepath)) {
      fs.writeFileSync(filepath, '{}', 'utf8')
    }
  }

  public merge(filepath: string): void {
    if (!fs.existsSync(filepath)) return
    let obj = loadJson(filepath)
    let current = loadJson(this.filepath)
    Object.assign(current, obj)
    writeJson(this.filepath, current)
    fs.unlinkSync(filepath)
  }

  private fetchContent(id: string, key: string): any {
    let res = loadJson(this.filepath)
    let obj = res[id]
    if (!obj) return undefined
    return obj[key]
  }

  private async update(id: string, key: string, value: any): Promise<void> {
    let { filepath } = this
    let current = loadJson(filepath)
    current[id] = current[id] || {}
    if (value !== undefined) {
      current[id][key] = deepClone(value)
    } else {
      delete current[id][key]
    }
    writeJson(filepath, current)
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
