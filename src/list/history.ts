import JsonDB from 'node-json-db'
import os from 'os'
import path from 'path'
import { isWindows } from '../util/platform'
import { ListManager } from './manager'
import { getCharCodes, fuzzyMatch } from '../util/fuzzy'
import workspace from '../workspace'
const logger = require('../util/logger')('list-history')

export default class History {
  private db: JsonDB
  private index = -1
  private loaded: string[] = []
  private current: string[] = []

  constructor(private manager: ListManager) {
    let root = isWindows ? path.join(os.homedir(), 'AppData/Local/coc') : path.join(os.homedir(), '.config/coc')
    this.db = new JsonDB(path.join(root, 'history'), true, true)
    let { prompt } = manager
    prompt.onDidChangeInput(input => {
      if (input == this.curr) return
      let codes = getCharCodes(input)
      this.current = this.loaded.filter(s => fuzzyMatch(codes, s))
      this.index = -1
    })
  }

  public get curr(): string | null {
    return this.index == -1 ? null : this.current[this.index]
  }

  // on list activted
  public load(): void {
    let { db } = this
    let { input } = this.manager.prompt
    let { name } = this.manager
    let arr = db.exists(`/${name}/${encodeURIComponent(workspace.cwd)}`) ? db.getData(`/${name}/${encodeURIComponent(workspace.cwd)}`) : null
    if (!arr || !Array.isArray(arr)) {
      this.loaded = []
    } else {
      this.loaded = arr
    }
    this.index = -1
    this.current = this.loaded.filter(s => s.startsWith(input))
  }

  public add(): void {
    let { loaded, db } = this
    let { name, prompt } = this.manager
    let { input } = prompt
    if (!input || input.length < 2) return
    let idx = loaded.indexOf(input)
    if (idx != -1) loaded.splice(idx, 1)
    loaded.push(input)
    if (loaded.length > 200) {
      loaded = loaded.slice(-200)
    }
    let { cwd } = workspace
    db.push(`/${name}/${encodeURIComponent(cwd)}`, loaded, true)
  }

  public previous(): void {
    let { current, index } = this
    if (!current || !current.length) return
    if (index <= 0) {
      this.index = current.length - 1
    } else {
      this.index = index - 1
    }
    this.manager.prompt.input = current[this.index] || ''
  }

  public next(): void {
    let { current, index } = this
    if (!current || !current.length) return
    if (index == current.length - 1) {
      this.index = 0
    } else {
      this.index = index + 1
    }
    this.manager.prompt.input = current[this.index] || ''
  }
}
