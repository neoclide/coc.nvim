import path from 'path'
import fs from 'fs-extra'

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
    this.file = path.join(base || process.env.COC_DATA_HOME, name)
  }

  /**
   * Load iems from mru file
   */
  public async load(): Promise<string[]> {
    let dir = path.dirname(this.file)
    try {
      fs.mkdirpSync(dir)
      if (!fs.existsSync(this.file)) {
        fs.writeFileSync(this.file, '', 'utf8')
      }
      let content = await fs.readFile(this.file, 'utf8')
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
      await fs.unlink(this.file)
    } catch (e) {
      // noop
    }
  }
}
