import path from 'path'
import * as cp from 'child_process'
import attach from '../attach'
import Plugin from '../plugin'
import { Neovim, Buffer } from '@chemzqm/neovim'
import services from '../services'
import { ServiceStat, VimCompleteItem } from '../types'

export interface CursorPosition {
  bufnum: number
  lnum: number
  col: number
}

process.on('uncaughtException', err => {
  // tslint:disable-next-line:no-console
  console.error(err.stack)
})

export class Helper {
  public nvim: Neovim
  public proc: cp.ChildProcess
  public plugin: Plugin

  public setup(): Promise<void> {
    const vimrc = path.resolve(__dirname, 'vimrc')
    let proc = this.proc = cp.spawn('nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {})
    let plugin = this.plugin = attach({ proc })
    this.nvim = plugin.nvim
    return new Promise(resolve => {
      plugin.emitter.once('ready', resolve)
    })
  }

  public async shutdown():Promise<void> {
    await this.plugin.dispose()
    this.nvim.quit()
    this.proc.kill()
  }

  public async reset():Promise<void> {
    await this.nvim.input('<esc>')
    await this.nvim.command('%bdelete!')
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
    let visible = await this.pumvisible()
    if (!visible) return false
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

  public async getItems():Promise<VimCompleteItem[]> {
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
}

export default new Helper()
