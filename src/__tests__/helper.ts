import { Buffer, Neovim } from '@chemzqm/neovim'
import * as cp from 'child_process'
import Emitter from 'events'
import path from 'path'
import attach from '../attach'
import Document from '../model/document'
import Plugin from '../plugin'
import services from '../services'
import { IWorkspace, ServiceStat, VimCompleteItem } from '../types'

export interface CursorPosition {
  bufnum: number
  lnum: number
  col: number
}

export class Helper extends Emitter {
  public nvim: Neovim
  public proc: cp.ChildProcess
  public plugin: Plugin

  public setup(uiAttach = true): Promise<void> {
    const vimrc = path.resolve(__dirname, 'vimrc')
    let proc = this.proc = cp.spawn('nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {
      cwd: __dirname
    })
    let plugin = this.plugin = attach({ proc })
    this.nvim = plugin.nvim
    if (uiAttach) {
      this.nvim.uiAttach(80, 80, {})
    }
    proc.on('exit', () => {
      this.proc = null
    })
    this.nvim.on('notification', (method, args) => {
      if (method == 'redraw') {
        try {
          let event = args[0][0]
          if (event) {
            this.emit(event, args[0])
          }
        } catch (e) {
          console.error(e.message) // tslint:disable-line
        }
      }
    })
    return new Promise(resolve => {
      plugin.once('ready', resolve)
    })
  }

  public async shutdown(): Promise<void> {
    await this.plugin.dispose()
    this.nvim.quit()
    await this.wait(300)
    if (this.proc) {
      this.proc.kill('SIGKILL')
    }
  }

  public waitPopup(): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        clearInterval(interval)
        reject(new Error('timeout after 5s'))
      }, 5000)
      let interval = setInterval(() => {
        this.nvim.call('pumvisible').then(visible => {
          if (visible) {
            clearTimeout(timeout)
            clearInterval(interval)
            resolve()
          }
        }, reject)
      }, 100)
    })
  }

  public async reset(): Promise<void> {
    await this.nvim.input('<esc>')
    await this.wait(30)
    await this.nvim.command('silent! %bdelete!')
    await this.wait(100)
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

  public async edit(file: string): Promise<Buffer> {
    await this.nvim.command(`exe 'edit ' . fnameescape('${file}')`)
    let buf = await this.nvim.buffer
    return buf
  }

  public async hide(): Promise<void> {
    await this.nvim.call('coc#_hide')
  }

  public async startinsert(): Promise<void> {
    let m = await this.nvim.call('mode')
    if (m[0] !== 'i') {
      await this.nvim.input('i')
    }
  }

  public async getcurpos(): Promise<CursorPosition> {
    let [bufnum, lnum, col] = await this.nvim.call('getcurpos')
    return { bufnum, lnum, col }
  }

  public async insert(chars: string): Promise<void> {
    await this.startinsert()
    await this.nvim.input(chars)
    let errmsg = await this.nvim.getVvar('errmsg') as string
    if (errmsg) {
      throw new Error(errmsg)
    }
  }

  public onServiceReady(id: string): Promise<void> {
    let service = services.getService(id)
    if (service && service.state == ServiceStat.Running) {
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        reject(new Error('server timeout after 2s'))
      }, 2000)
      let cb = serviceId => {
        if (serviceId == id) {
          clearTimeout(timer)
          services.removeListener('ready', cb)
          resolve()
        }
      }
      services.on('ready', cb)
    })
  }

  public get workspace(): IWorkspace {
    return require('../workspace').default
  }

  public async createDocument(name: string): Promise<Document> {
    let buf = await this.edit(name)
    await this.wait(100)
    return this.workspace.getDocument(buf.id)
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
}
export default new Helper()
