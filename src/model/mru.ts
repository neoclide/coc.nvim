import path from 'path'
import os from 'os'
import fs from 'fs'
import util from 'util'
import mkdirp from 'mkdirp'
const isWindows = process.platform == 'win32'
const root = isWindows ? path.join(os.homedir(), 'AppData/Local/coc') : path.join(os.homedir(), '.config/coc')

/**
 * Mru - manage string items as lines in mru file.
 */
export default class Mru {
  private file: string

  /**
   * @param {string} name unique name
   * @param {string} base? optional directory name, default to config root of coc.nvim
   */
  constructor(private name: string, base?: string) {
    this.file = path.join(base || root, name)
  }

  /**
   * Load iems from mru file
   */
  public async load(): Promise<string[]> {
    let dir = path.dirname(this.file)
    try {
      mkdirp.sync(dir)
      if (!fs.existsSync(this.file)) {
        fs.writeFileSync(this.file, '', 'utf8')
      }
      let content = await util.promisify(fs.readFile)(this.file, 'utf8')
      content = content.trim()
      return content.length ? content.trim().split('\n') : []
    } catch (e) {
      return []
    }
  }

  /**
   * Add item to mru file.
   */
  public async add(item: string): Promise<void> {
    let items = await this.load()
    let idx = items.indexOf(item)
    if (idx !== -1) items.splice(idx, 1)
    items.unshift(item)
    fs.writeFileSync(this.file, items.join('\n'), 'utf8')
  }

  /**
   * Remove item from mru file.
   */
  public async remove(item: string): Promise<void> {
    let items = await this.load()
    let idx = items.indexOf(item)
    if (idx !== -1) {
      items.splice(idx, 1)
      fs.writeFileSync(this.file, items.join('\n'), 'utf8')
    }
  }

  /**
   * Remove the data file.
   */
  public async clean(): Promise<void> {
    try {
      await util.promisify(fs.unlink)(this.file)
    } catch (e) {
      // noop
    }
  }
}
