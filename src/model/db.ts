import path from 'path'
import fs from 'fs'
import * as fsAsync from '../util/fs'
import mkdirp from 'mkdirp'

export default class DB {
  constructor(public readonly filepath: string) {
  }

  public fetch(key: string): any {
    let obj = this.load()
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

  public exists(key: string): boolean {
    let obj = this.load()
    let parts = key.split('.')
    for (let part of parts) {
      if (typeof obj[part] == 'undefined') {
        return false
      }
      obj = obj[part]
    }
    return true
  }

  public delete(key: string): void {
    let obj = this.load()
    let origin = obj
    let parts = key.split('.')
    let len = parts.length
    for (let i = 0; i < len; i++) {
      if (typeof obj[parts[i]] == 'undefined') {
        break
      }
      if (i == len - 1) {
        delete obj[parts[i]]
        fs.writeFileSync(this.filepath, JSON.stringify(origin, null, 2), 'utf8')
        break
      }
      obj = obj[parts[i]]
    }
  }

  public push(key: string, data: number | null | boolean | string | { [index: string]: any }): void {
    let origin = this.load() || {}
    let obj = origin
    let parts = key.split('.')
    let len = parts.length
    if (obj == null) {
      let dir = path.dirname(this.filepath)
      mkdirp.sync(dir)
      obj = origin
    }
    for (let i = 0; i < len; i++) {
      let key = parts[i]
      if (i == len - 1) {
        obj[key] = data
        fs.writeFileSync(this.filepath, JSON.stringify(origin, null, 2))
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

  private load(): any {
    let dir = path.dirname(this.filepath)
    let stat = fs.statSync(dir)
    if (!stat || !stat.isDirectory()) {
      mkdirp.sync(dir)
      fs.writeFileSync(this.filepath, '{}', 'utf8')
      return {}
    }
    try {
      let content = fs.readFileSync(this.filepath, 'utf8')
      return JSON.parse(content.trim())
    } catch (e) {
      fs.writeFileSync(this.filepath, '{}', 'utf8')
      return {}
    }
  }

  public clear(): void {
    let stat = fs.statSync(this.filepath)
    if (!stat || !stat.isFile()) return
    fs.writeFileSync(this.filepath, '{}', 'utf8')
  }

  public destroy(): void {
    if (fs.existsSync(this.filepath)) {
      fs.unlinkSync(this.filepath)
    }
  }
}
