import type { Buffer, Neovim, Window } from '@chemzqm/neovim'
import * as cp from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs'
import net, { Server } from 'net'
import os from 'os'
import path from 'path'
import util from 'util'
import { v4 as uuid } from 'uuid'
import { Disposable } from 'vscode-languageserver-protocol'
import attach from '../attach'
import type { Completion } from '../completion'
import { DurationCompleteItem } from '../completion/types'
import events from '../events'
import type Document from '../model/document'
import type Plugin from '../plugin'
import type { ProviderResult } from '../provider'
import { OutputChannel } from '../types'
import { equals } from '../util/object'
import { terminate } from '../util/processes'
import type { Workspace } from '../workspace'
const vimrc = path.resolve(__dirname, 'vimrc')

export interface CursorPosition {
  bufnum: number
  lnum: number
  col: number
}

const nullChannel: OutputChannel = {
  content: '',
  show: () => {},
  dispose: () => {},
  name: 'null',
  append: () => {},
  appendLine: () => {},
  clear: () => {},
  hide: () => {}
}

process.on('uncaughtException', err => {
  let msg = 'Uncaught exception: ' + err.stack
  console.error(msg)
})

export class Helper extends EventEmitter {
  public proc: cp.ChildProcess
  private server: Server
  public plugin: Plugin

  constructor() {
    super()
    this.setMaxListeners(99)
  }

  public get workspace(): Workspace {
    if (!this.plugin || !this.plugin.workspace) throw new Error('helper not attached')
    return this.plugin.workspace
  }

  public get completion(): Completion {
    if (!this.plugin || !this.plugin.completion) throw new Error('helper not attached')
    return this.plugin.completion
  }

  public get nvim(): Neovim {
    return this.plugin.nvim
  }

  public async setup(init = true): Promise<Plugin> {
    let proc = this.proc = cp.spawn(process.env.NVIM_COMMAND ?? 'nvim', ['-u', vimrc, '-i', 'NONE', '--embed'], {
      cwd: __dirname
    })
    proc.unref()
    let plugin = this.plugin = attach({ proc })
    await this.nvim.uiAttach(160, 80, {})
    this.nvim.call('coc#rpc#set_channel', [1], true)
    this.nvim.on('vim_error', err => {
      // console.error('Error from vim: ', err)
    })
    if (init) await plugin.init('')
    return plugin
  }

  public async setupVim(): Promise<void> {
    if (process.env.VIM_NODE_RPC != '1') {
      throw new Error(`VIM_NODE_RPC should be 1`)
    }
    let server
    let promise = new Promise<void>(resolve => {
      server = this.server = net.createServer(socket => {
        this.plugin = attach({ reader: socket, writer: socket })
        this.nvim.on('vim_error', err => {
          // console.error('Error from vim: ', err)
        })
        resolve()
      })
    })
    let address = await this.listenOnVim(server)
    let proc = this.proc = cp.spawn(process.env.VIM_COMMAND ?? 'vim', ['--clean', '--not-a-term', '-u', vimrc], {
      stdio: 'pipe',
      shell: true,
      cwd: __dirname,
      env: {
        COC_NVIM_REMOTE_ADDRESS: address,
        ...process.env
      }
    })
    proc.on('error', err => {
      console.error(err)
    })
    proc.on('exit', code => {
      if (code) console.error('vim exit with code ' + code)
    })
    await promise
    await this.plugin.init('')
  }

  private async listenOnVim(server: Server): Promise<string> {
    const isWindows = process.platform === 'win32'
    return new Promise((resolve, reject) => {
      if (!isWindows) {
        // not work on old version vim.
        const socket = path.join(os.tmpdir(), `coc-test-${uuid()}.sock`)
        server.listen(socket, () => {
          resolve(socket)
        })
        server.on('error', reject)
        server.unref()
      } else {
        getPort().then(port => {
          let localhost = '127.0.0.1'
          server.listen(port, localhost, () => {
            resolve(`${localhost}:${port}`)
          })
          server.on('error', reject)
        }, reject)
      }
      server.unref()
    })
  }

  public async reset(): Promise<void> {
    let mode = await this.nvim.mode
    if (mode.blocking && mode.mode == 'r') {
      await this.nvim.input('<cr>')
    } else if (mode.mode != 'n' || mode.blocking) {
      await this.nvim.call('feedkeys', [String.fromCharCode(27), 'in'])
    }
    this.completion.stop(true)
    this.workspace.reset()
    await this.nvim.command('silent! %bwipeout! | setl nopreviewwindow')
    await this.wait(10)
    await this.workspace.document
  }

  public async shutdown(): Promise<void> {
    if (this.plugin) this.plugin.dispose()
    if (this.nvim) await this.nvim.quit()
    if (this.server) this.server.close()
    if (this.proc) terminate(this.proc)
    if (typeof global.gc === 'function') {
      global.gc()
    }
    await this.wait(30)
  }

  public wait(ms = 30): Promise<void> {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }

  public async waitPrompt(): Promise<void> {
    for (let i = 0; i < 60; i++) {
      await this.wait(30)
      let prompt = await this.nvim.call('coc#prompt#activated')
      if (prompt) return
    }
    throw new Error('Wait prompt timeout after 2s')
  }

  public async waitPromptWin(): Promise<number> {
    for (let i = 0; i < 60; i++) {
      await this.wait(30)
      let winid = await this.nvim.call('coc#dialog#get_prompt_win') as number
      if (winid != -1) return winid
    }
    throw new Error('Wait prompt window timeout after 2s')
  }

  public async waitFloat(): Promise<number> {
    for (let i = 0; i < 50; i++) {
      await this.wait(20)
      let winid = await this.nvim.call('GetFloatWin') as number
      if (winid) return winid
    }
    throw new Error('timeout after 2s')
  }

  public async doAction(method: string, ...args: any[]): Promise<any> {
    return await this.plugin.cocAction(method, ...args)
  }

  public async items(): Promise<DurationCompleteItem[]> {
    return this.completion?.activeItems.slice()
  }

  public async waitPopup(): Promise<void> {
    let visible = await this.nvim.call('coc#pum#visible')
    if (visible) return
    let res = await events.race(['MenuPopupChanged'], 5000)
    if (!res) throw new Error('wait pum timeout after 5s')
  }

  public async confirmCompletion(idx: number): Promise<void> {
    await this.nvim.call('coc#pum#select', [idx, 1, 1])
  }

  public async visible(word: string, source?: string): Promise<boolean> {
    await this.waitPopup()
    let items = this.completion.activeItems
    if (!items) return false
    let item = items.find(o => o.word == word)
    if (!item) return false
    if (source && item.source.name != source) return false
    return true
  }

  public async edit(file?: string): Promise<Buffer> {
    if (!file || !path.isAbsolute(file)) {
      file = path.join(__dirname, file ? file : `${uuid()}`)
    }
    let escaped = await this.nvim.call('fnameescape', file) as string
    await this.nvim.command(`edit ${escaped}`)
    let doc = await this.workspace.document
    return doc.buffer
  }

  public async createDocument(name?: string): Promise<Document> {
    let buf = await this.edit(name)
    let doc = this.workspace.getDocument(buf.id)
    if (!doc) return await this.workspace.document
    return doc
  }

  public async listInput(input: string): Promise<void> {
    await events.fire('InputChar', ['list', input, 0])
  }

  public async getCmdline(lnum?: number): Promise<string> {
    let str = ''
    let n = await this.nvim.eval('&lines') as number
    for (let i = 1, l = 70; i < l; i++) {
      let ch = await this.nvim.call('screenchar', [lnum ?? n - 1, i]) as number
      if (ch == -1) break
      str += String.fromCharCode(ch)
    }
    return str.trim()
  }

  public updateConfiguration(key: string, value: any): () => void {
    let curr = this.workspace.getConfiguration(key)
    let { configurations } = this.workspace
    configurations.updateMemoryConfig({ [key]: value })
    return () => {
      configurations.updateMemoryConfig({ [key]: curr })
    }
  }

  public async mockFunction(name: string, result: string | number | any): Promise<void> {
    let content = `
    function! ${name}(...)
      return ${typeof result == 'number' ? result : JSON.stringify(result)}
    endfunction`
    await this.nvim.exec(content)
  }

  public async getFloat(kind?: string): Promise<Window> {
    if (!kind) {
      let ids = await this.nvim.call('coc#float#get_float_win_list') as number[]
      return ids.length ? this.nvim.createWindow(ids[0]) : undefined
    } else {
      let id = await this.nvim.call('coc#float#get_float_by_kind', [kind]) as number
      return id ? this.nvim.createWindow(id) : undefined
    }
  }

  public async getWinLines(winid: number): Promise<string[]> {
    return await this.nvim.eval(`getbufline(winbufnr(${winid}), 1, '$')`) as string[]
  }

  public async waitFor<T>(method: string, args: any[], value: T): Promise<void> {
    let find = false
    for (let i = 0; i < 100; i++) {
      await this.wait(20)
      let res = await this.nvim.call(method, args) as T
      if (equals(res, value) || (value instanceof RegExp && value.test(res.toString()))) {
        find = true
        break
      }
    }
    if (!find) {
      throw new Error(`waitFor ${value} timeout`)
    }
  }

  public async waitNotification(event: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let fn = (method: string) => {
        if (method == event) {
          clearTimeout(timer)
          this.nvim.removeListener('notification', fn)
          resolve()
        }
      }
      let timer = setTimeout(() => {
        this.nvim.removeListener('notification', fn)
        reject(new Error('wait notification timeout after 2s'))
      }, 2000)
      this.nvim.on('notification', fn)
    })
  }

  public async waitValue<T>(fn: () => ProviderResult<T>, value: T): Promise<void> {
    let find = false
    for (let i = 0; i < 200; i++) {
      await this.wait(20)
      let res = await Promise.resolve(fn())
      if (equals(res, value)) {
        find = true
        break
      }
    }
    if (!find) {
      throw new Error(`waitValue ${value} timeout`)
    }
  }

  public createNullChannel(): OutputChannel {
    return nullChannel
  }
}

export async function createTmpFile(content: string, disposables?: Disposable[]): Promise<string> {
  let tmpFolder = path.join(os.tmpdir(), `coc-${process.pid}`)
  if (!fs.existsSync(tmpFolder)) {
    fs.mkdirSync(tmpFolder)
  }
  let fsPath = path.join(tmpFolder, uuid())
  await util.promisify(fs.writeFile)(fsPath, content, 'utf8')
  if (disposables) {
    disposables.push(Disposable.create(() => {
      if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath)
    }))
  }
  return fsPath
}

export function makeLine(length) {
  let result = ''
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 (){};,\\<>+=`^*!@#$%[]:"/?'
  let charactersLength = characters.length
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() *
      charactersLength))
  }
  return result
}

let currPort = 5000
export function getPort(): Promise<number> {
  let port = currPort
  let fn = cb => {
    let server = net.createServer()
    server.listen(port, () => {
      server.once('close', () => {
        currPort = port + 1
        cb(port)
      })
      server.close()
    })
    server.on('error', () => {
      port += 1
      fn(cb)
    })
  }
  return new Promise(resolve => {
    fn(resolve)
  })
}

export default new Helper()
