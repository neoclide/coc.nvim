import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import * as cp from 'child_process'
import Emitter from 'events'
import fs from 'fs'
import os from 'os'
import path from 'path'
import util from 'util'
import attach from '../attach'
import Document from '../model/document'
import Plugin from '../plugin'
import workspace from '../workspace'
import uuid = require('uuid/v4')
import { VimCompleteItem } from '../types'

export interface CursorPosition {
  bufnum: number
  lnum: number
  col: number
}

process.on('uncaughtException', err => {
  let msg = 'Uncaught exception: ' + err.stack
  // tslint:disable-next-line: no-console
  console.error(msg)
})
export class Helper extends Emitter {
  public nvim: Neovim
  public proc: cp.ChildProcess
  public plugin: Plugin

  constructor() {
    super()
    this.setMaxListeners(99)
  }

  public setup(): Promise<void> {
    const vimrc = path.resolve(__dirname, 'vimrc')
    let proc = this.proc = cp.spawn('nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {
      cwd: __dirname
    })
    let plugin = this.plugin = attach({ proc })
    this.nvim = plugin.nvim
    this.nvim.uiAttach(80, 80, {}).catch(_e => {
      // noop
    })
    proc.on('exit', () => {
      this.proc = null
    })
    this.nvim.on('notification', (method, args) => {
      if (method == 'redraw') {
        for (let arg of args) {
          let event = arg[0]
          this.emit(event, arg.slice(1))
        }
      }
    })
    return new Promise(resolve => {
      plugin.once('ready', resolve)
    })
  }

  public async shutdown(): Promise<void> {
    await this.plugin.dispose()
    await this.nvim.quit()
    if (this.proc) {
      this.proc.kill('SIGKILL')
    }
    await this.wait(60)
  }

  public async waitPopup(): Promise<void> {
    for (let i = 0; i < 40; i++) {
      await this.wait(50)
      let visible = await this.nvim.call('pumvisible')
      if (visible) return
    }
    throw new Error('timeout after 2s')
  }

  public async waitFloat(): Promise<number> {
    for (let i = 0; i < 40; i++) {
      await this.wait(50)
      let winid = await this.nvim.call('coc#util#get_float')
      if (winid) return winid
    }
    throw new Error('timeout after 2s')
  }

  public async selectCompleteItem(idx: number): Promise<void> {
    await this.nvim.call('nvim_select_popupmenu_item', [idx, true, true, {}])
  }

  public async reset(): Promise<void> {
    let mode = await this.nvim.call('mode')
    if (mode !== 'n') {
      await this.nvim.command('stopinsert')
      await this.nvim.call('feedkeys', [String.fromCharCode(27), 'in'])
    }
    await this.nvim.command('silent! %bwipeout!')
    await this.wait(60)
  }

  public async pumvisible(): Promise<boolean> {
    let res = await this.nvim.call('pumvisible', []) as number
    return res == 1
  }

  public wait(ms = 30): Promise<void> {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }

  public async visible(word: string, source?: string): Promise<boolean> {
    await this.waitPopup()
    let context = await this.nvim.getVar('coc#_context') as any
    let items = context.candidates
    if (!items) return false
    let item = items.find(o => o.word == word)
    if (!item || !item.user_data) return false
    try {
      let o = JSON.parse(item.user_data)
      if (source && o.source !== source) {
        return false
      }
    } catch (e) {
      return false
    }
    return true
  }

  public async notVisible(word: string): Promise<boolean> {
    let items = await this.getItems()
    return items.findIndex(o => o.word == word) == -1
  }

  public async getItems(): Promise<VimCompleteItem[]> {
    let visible = await this.pumvisible()
    if (!visible) return []
    let context = await this.nvim.getVar('coc#_context') as any
    let items = context.candidates
    return items || []
  }

  public async edit(file?: string): Promise<Buffer> {
    file = path.join(__dirname, file ? file : `${uuid()}`)
    let escaped = await this.nvim.call('fnameescape', file)
    await this.nvim.command(`edit ${escaped}`)
    await this.wait(60)
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    return this.nvim.createBuffer(bufnr)
  }

  public async createDocument(name?: string): Promise<Document> {
    let buf = await this.edit(name)
    let doc = workspace.getDocument(buf.id)
    if (!doc) return await workspace.document
    return doc
  }

  public async getCmdline(): Promise<string> {
    let str = ''
    for (let i = 1, l = 70; i < l; i++) {
      let ch = await this.nvim.call('screenchar', [79, i])
      if (ch == -1) break
      str += String.fromCharCode(ch)
    }
    return str.trim()
  }

  public updateConfiguration(key: string, value: any): void {
    let { configurations } = workspace as any
    configurations.updateUserConfig({ [key]: value })
  }

  public async mockFunction(name: string, result: string | number | any): Promise<void> {
    let content = `
    function! ${name}(...)
      return ${JSON.stringify(result)}
    endfunction
    `
    let file = await createTmpFile(content)
    await this.nvim.command(`source ${file}`)
  }

  public async items(): Promise<VimCompleteItem[]> {
    let context = await this.nvim.getVar('coc#_context')
    return context['candidates'] || []
  }

  public async screenLine(line: number): Promise<string> {
    let res = ''
    for (let i = 1; i <= 80; i++) {
      let ch = await this.nvim.call('screenchar', [line, i])
      res = res + String.fromCharCode(ch)
    }
    return res
  }

  public async getFloat(): Promise<Window> {
    let wins = await this.nvim.windows
    let floatWin: Window
    for (let win of wins) {
      let f = await win.getVar('float')
      if (f) floatWin = win
    }
    return floatWin
  }
}

export async function createTmpFile(content: string): Promise<string> {
  let tmpFolder = path.join(os.tmpdir(), `coc-${process.pid}`)
  if (!fs.existsSync(tmpFolder)) {
    fs.mkdirSync(tmpFolder)
  }
  let filename = path.join(tmpFolder, uuid())
  await util.promisify(fs.writeFile)(filename, content, 'utf8')
  return filename
}

export default new Helper()
