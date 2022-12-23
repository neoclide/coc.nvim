'use strict'
import { fs, path } from '../util/node'
import { createLogger } from '../logger'
import { isFalsyOrEmpty } from '../util/array'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { DataBase } from './db'
import { toText } from '../util/string'
const logger = createLogger('list-history')

export default class InputHistory {
  private _index = -1
  private _filtered: string[] = []
  private historyInput: string

  constructor(
    private prompt: { input: string },
    private name: string,
    private db: DataBase,
    private cwd: string
  ) {
  }

  private get loaded(): string[] {
    return this.db.getHistory(this.name, this.cwd)
  }

  public get filtered(): ReadonlyArray<string> {
    return this._filtered
  }

  public get index(): number {
    return this._index
  }

  public static migrate(folder: string): void {
    try {
      let files = fs.readdirSync(folder)
      files = files.filter(f => f.startsWith('list-') && f.endsWith('-history.json') && fs.statSync(path.join(folder, f)).isFile())
      if (files.length === 0) return
      let db = new DataBase()
      for (let file of files) {
        let name = file.match(/^list-(.*)-history.json$/)[1]
        let content = fs.readFileSync(path.join(folder, file), 'utf8')
        let obj = JSON.parse(content) as { [key: string]: string[] }
        for (let [key, texts] of Object.entries(obj)) {
          let folder = Buffer.from(key, 'base64').toString('utf8')
          if (Array.isArray(texts)) {
            texts.forEach(text => {
              db.addItem(name, text, folder)
            })
          }
        }
      }
      files.forEach(f => {
        fs.unlinkSync(path.join(folder, f))
      })
      db.save()
    } catch (e) {
      logger.error(`Error on migrate history:`, e)
    }
  }

  public get curr(): string | null {
    return this._index == -1 || this._filtered == null ? null : this._filtered[this._index]
  }

  public filter(): void {
    let { input } = this.prompt
    if (input === this.curr) return
    this.historyInput = ''
    if (input.length > 0) {
      let codes = getCharCodes(input)
      this._filtered = this.loaded.filter(s => fuzzyMatch(codes, s))
    } else {
      this._filtered = this.loaded
    }
    this._index = -1
  }

  public add(): void {
    let { db, prompt, cwd } = this
    let { input } = prompt
    if (!input || input.length < 2 || input == this.historyInput) return
    db.addItem(this.name, input, cwd)
  }

  public previous(): void {
    let { _filtered, _index } = this
    if (isFalsyOrEmpty(_filtered)) return
    if (_index <= 0) {
      this._index = _filtered.length - 1
    } else {
      this._index = _index - 1
    }
    this.historyInput = this.prompt.input = toText(_filtered[this._index])
  }

  public next(): void {
    let { _filtered, _index } = this
    if (isFalsyOrEmpty(_filtered)) return
    if (_index == _filtered.length - 1) {
      this._index = 0
    } else {
      this._index = _index + 1
    }
    this.historyInput = this.prompt.input = toText(_filtered[this._index])
  }
}
