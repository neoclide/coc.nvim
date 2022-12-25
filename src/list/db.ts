/**
 * First byte tables length,
 * 4 * table_length each table byte length.
 */
import { fs, path } from '../util/node'
import { createLogger } from '../logger'
import { byteLength, byteSlice } from '../util/string'
import { dataHome } from '../util/constants'
const logger = createLogger('list-db')

const DB_PATH = path.join(dataHome, 'list_history.dat')

// text, name index, folder index
type HistoryItem = [string, number, number]

export class DataBase {
  private folders: string[] = []
  private names: string[] = []
  private items: HistoryItem[] = []
  private _changed = false
  constructor() {
    try {
      this.load()
    } catch (e) {
      logger.error(`Error on load db`, e)
    }
  }

  public get currItems(): ReadonlyArray<HistoryItem> {
    return this.items
  }

  public getHistory(name: string, folder: string): string[] {
    let nameIndex = this.names.indexOf(name)
    let folderIndex = this.folders.indexOf(folder)
    if (nameIndex == -1 || folderIndex == -1) return []
    return this.items.reduce((p, c) => {
      if (c[1] == nameIndex && c[2] == folderIndex) {
        p.push(c[0])
      }
      return p
    }, [] as string[])
  }

  public addItem(name: string, text: string, folder: string): void {
    let { folders, names } = this
    if (byteLength(text) > 255) {
      text = byteSlice(text, 0, 255)
    }
    if (!folders.includes(folder)) {
      folders.push(folder)
    }
    if (!names.includes(name)) {
      names.push(name)
    }
    let nameIndex = names.indexOf(name)
    let folderIndex = folders.indexOf(folder)
    let idx = this.items.findIndex(o => o[0] == text && o[1] == nameIndex && o[2] == folderIndex)
    if (idx != -1) this.items.splice(idx, 1)
    this.items.push([text, nameIndex, folderIndex])
    this._changed = true
  }

  public save(): void {
    let { folders, items, names } = this
    if (!this._changed) return
    let bufs = folders.reduce((p, folder) => {
      p.push(Buffer.from(folder, 'utf8'), Buffer.alloc(1))
      return p
    }, [] as Buffer[])
    let folderBuf = Buffer.concat(bufs)
    bufs = names.reduce((p, name) => {
      p.push(Buffer.from(name, 'utf8'), Buffer.alloc(1))
      return p
    }, [] as Buffer[])
    let nameBuf = Buffer.concat(bufs)
    let buf = Buffer.allocUnsafe(9)
    buf.writeUInt8(2, 0)
    buf.writeUInt32BE(folderBuf.byteLength, 1)
    buf.writeUInt32BE(nameBuf.byteLength, 5)
    bufs = items.reduce((p, item) => {
      let b = Buffer.from(item[0], 'utf8')
      p.push(Buffer.from([b.byteLength]), b, Buffer.from([item[1], item[2]]))
      return p
    }, [] as Buffer[])
    let resultBuf = Buffer.concat([buf, folderBuf, nameBuf, ...bufs])
    fs.writeFileSync(DB_PATH, resultBuf)
    this._changed = false
  }

  public load(): void {
    if (!fs.existsSync(DB_PATH)) return
    let buffer = fs.readFileSync(DB_PATH)
    let folder_length = buffer.readUInt32BE(1)
    let name_length = buffer.readUInt32BE(5)
    let folderBuf = buffer.slice(9, 9 + folder_length)
    let start = 0
    let folders: string[] = []
    let names: string[] = []
    for (let i = 0; i < folderBuf.byteLength; i++) {
      if (folderBuf[i] === 0) {
        let text = folderBuf.slice(start, i).toString('utf8')
        folders.push(text)
        start = i + 1
      }
    }
    let offset = 9 + folder_length
    let nameBuf = buffer.slice(offset, offset + name_length)
    start = 0
    for (let i = 0; i < nameBuf.byteLength; i++) {
      if (nameBuf[i] === 0) {
        let text = nameBuf.slice(start, i).toString('utf8')
        names.push(text)
        start = i + 1
      }
    }
    let itemsBuf = buffer.slice(offset + name_length)
    start = 0
    let total = itemsBuf.byteLength
    while (start < total) {
      let len = itemsBuf.readUInt8(start)
      let end = start + 1 + len
      let text = itemsBuf.slice(start + 1, end).toString('utf8')
      this.items.push([text, itemsBuf.readUInt8(end), itemsBuf.readUInt8(end + 1)])
      start = end + 2
    }
    this.names = names
    this.folders = folders
  }
}

export default new DataBase()
