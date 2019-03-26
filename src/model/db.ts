import path from 'path'
import fs from 'fs'
import * as fsAsync from '../util/fs'
import { mkdirp } from '../util'

export default class DB {
  constructor(
    public readonly filepath: string
  ) {
  }

  public async fetch(key: string): Promise<any> {
    let obj = await this.load()
    if (obj == null) return undefined
    if (!key) return obj
    let parts = key.split('.')
    for (let part of parts) {
      if (typeof obj[part] == 'undefined') {
        return undefined
      }
      obj = obj[part]
    }
    return obj
  }

  public fetchSync(key: string): any {
    try {
      let content = fs.readFileSync(this.filepath, 'utf8')
      let obj = JSON.parse(content)
      if (obj == null) return undefined
      let parts = key.split('.')
      for (let part of parts) {
        if (typeof obj[part] == 'undefined') {
          return undefined
        }
        obj = obj[part]
      }
    } catch (e) {
      return undefined
    }
  }

  public async exists(key: string): Promise<boolean> {
    let obj = await this.load()
    if (obj == null) return false
    let parts = key.split('.')
    for (let part of parts) {
      if (typeof obj[part] == 'undefined') {
        return false
      }
      obj = obj[part]
    }
    return true
  }

  public async delete(key: string): Promise<void> {
    let obj = await this.load()
    if (obj == null) return
    let origin = obj
    let parts = key.split('.')
    let len = parts.length
    for (let i = 0; i < len; i++) {
      if (typeof obj[parts[i]] == 'undefined') {
        break
      }
      if (i == len - 1) {
        delete obj[parts[i]]
        await fsAsync.writeFile(this.filepath, JSON.stringify(origin, null, 2))
        break
      }
      obj = obj[parts[i]]
    }
  }

  public async push(key: string, data: number | null | boolean | string | { [index: string]: any }): Promise<void> {
    let origin = (await this.load()) || {}
    let obj = origin
    let parts = key.split('.')
    let len = parts.length
    if (obj == null) {
      let dir = path.dirname(this.filepath)
      await mkdirp(dir)
      obj = origin
    }
    for (let i = 0; i < len; i++) {
      let key = parts[i]
      if (i == len - 1) {
        obj[key] = data
        await fsAsync.writeFile(this.filepath, JSON.stringify(origin, null, 2))
        break
      }
      if (typeof obj[key] == 'undefined') {
        obj[key] = {}
        obj = obj[key]
      } else {
        obj = obj[key]
      }
    }
  }

  private async load(): Promise<any> {
    let stat = await fsAsync.statAsync(this.filepath)
    if (!stat || !stat.isFile()) return null
    let content = await fsAsync.readFile(this.filepath, 'utf8')
    if (!content.trim()) return {}
    try {
      return JSON.parse(content)
    } catch (e) {
      return null
    }
  }

  public async clear(): Promise<void> {
    let stat = await fsAsync.statAsync(this.filepath)
    if (!stat || !stat.isFile()) return
    await fsAsync.writeFile(this.filepath, '')
  }

  public async destroy(): Promise<void> {
    await fsAsync.unlinkAsync(this.filepath)
  }
}
