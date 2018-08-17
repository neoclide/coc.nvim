import { Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import path from 'path'
import { TerminalResult } from '../types'
import { echoMessage, executable, showQuickpick } from '../util'
import { statAsync } from '../util/fs'
import workspace from '../workspace'
// const logger = require('../util/logger')('model-moduleManager')
type Callback = (res: TerminalResult) => void

const isLinux = process.platform === 'linux'

// manage global modules
export default class ModuleManager extends EventEmitter {
  private _npmFolder: string | undefined
  private _yarnFolder: string | undefined
  private taskId = 1
  private installing: Map<number, string> = new Map()
  private disables: string[] = []
  private callbacks: Map<number, Callback> = new Map()

  public handleTerminalResult(res: TerminalResult): void {
    if (!res.id) return
    let { id } = res
    if (this.installing.has(id)) {
      if (res.success) {
        this.emit('installed', this.installing.get(id))
      }
      this.installing.delete(id)
    } else {
      let cb = this.callbacks.get(id)
      if (cb) {
        this.callbacks.delete(id)
        cb(res)
      }
    }
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public get nodeFolder(): Promise<string> {
    if (this._npmFolder) return Promise.resolve(this._npmFolder)
    return this.nvim.call('coc#util#module_folder', 'npm').then(folder => {
      this._npmFolder = folder
      return folder
    })
  }

  public get yarnFolder(): Promise<string> {
    if (this._yarnFolder) return Promise.resolve(this._yarnFolder)
    return this.nvim.call('coc#util#module_folder', 'yarn').then(folder => {
      this._yarnFolder = folder
      return folder
    })
  }

  public async resolveModule(mod: string): Promise<string> {
    let nodeFolder = await this.nodeFolder
    let yarnFolder = await this.yarnFolder
    if (nodeFolder) {
      let s = await statAsync(path.join(nodeFolder, mod, 'package.json'))
      if (s && s.isFile()) return path.join(nodeFolder, mod)
    }
    if (yarnFolder) {
      let s = await statAsync(path.join(yarnFolder, mod, 'package.json'))
      if (s && s.isFile()) return path.join(yarnFolder, mod)
    }
    return null
  }

  public async installModule(mod: string, section?: string): Promise<number> {
    let mods = Array.from(this.installing.values())
    if (mods.indexOf(mod) !== -1) return
    if (this.disables.indexOf(mod) !== -1) return
    let { nvim } = this
    let id = this.taskId
    let items = [
      'Use npm to install',
      'Use yarn to install',
      `Disable "${section}"`
    ]
    let idx = await showQuickpick(nvim, items, `${mod} not found, choose action by number`)
    // cancel
    if (idx == -1) return
    if (idx == 2) {
      this.disables.push(mod)
      if (section) {
        let config = workspace.getConfiguration(section)
        config.update('enable', false, true)
        echoMessage(nvim, `${section} disabled, to change this, use :CocConfig to edit configuration file.`)
      }
      return
    }
    this.installing.set(id, mod)
    this.taskId = this.taskId + 1
    let pre = isLinux ? 'sudo ' : ''
    let cmd = idx == 0 ? `${pre} npm install -g ${mod}` : `yarn global add ${mod}`
    if (idx == 1 && !executable('yarn')) {
      try {
        await this.runCommand('curl --compressed -o- -L https://yarnpkg.com/install.sh | bash')
      } catch (e) {
        return
      }
    }
    nvim.call('coc#util#open_terminal', [{ id, cmd }], true)
    return id
  }

  public runCommand(cmd: string, cwd?: string, timeout?: number): Promise<TerminalResult> {
    let id = this.taskId
    this.taskId = this.taskId + 1
    this.nvim.call('coc#util#open_terminal', [{ id, cmd, cwd: cwd || workspace.root }], true)
    return new Promise((resolve, reject) => {
      let called = false
      let tid
      if (timeout) {
        tid = setTimeout(() => {
          called = true
          reject(new Error(`command ${cmd} timeout after ${timeout}s`))
        }, timeout * 1000)
      }
      this.callbacks.set(id, res => {
        if (called) return
        if (tid) clearTimeout(tid)
        resolve(res)
      })
    })
  }
}
