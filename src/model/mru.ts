import path from 'path'
import os from 'os'
import fs from 'fs'
import util from 'util'
const isWindows = process.platform == 'win32'
const root = isWindows ? path.join(os.homedir(), 'AppData/Local/coc') : path.join(os.homedir(), '.config/coc')

export default class Mru {
  private file: string

  constructor(private name: string, base?: string) {
    this.file = path.join(base || root, name)
  }

  public async load(): Promise<string[]> {
    try {
      let content = await util.promisify(fs.readFile)(this.file, 'utf8')
      content = content.trim()
      return content.length ? content.trim().split('\n') : []
    } catch (e) {
      return []
    }
  }

  public async add(item: string): Promise<void> {
    let items = await this.load()
    let idx = items.indexOf(item)
    if (idx !== -1) items.splice(idx, 1)
    items.unshift(item)
    await util.promisify(fs.writeFile)(this.file, items.join('\n'), 'utf8')
  }

  public async remove(item: string): Promise<void> {
    let items = await this.load()
    let idx = items.indexOf(item)
    if (idx !== -1) {
      items.splice(idx, 1)
      await util.promisify(fs.writeFile)(this.file, items.join('\n'), 'utf8')
    }
  }

  public async clean(): Promise<void> {
    try {
      await util.promisify(fs.unlink)(this.file)
    } catch (e) {
      // noop
    }
  }
}
