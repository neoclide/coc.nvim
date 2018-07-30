import path from 'path'
import {EventEmitter} from 'events'
import { TerminalResult } from '../types'
import { showQuickpick, echoMessage } from '../util'
import { Neovim } from '@chemzqm/neovim'
import { statAsync } from '../util/fs'
// const logger = require('../util/logger')('model-moduleManager')
const isLinux = process.platform === 'linux'

// manage global modules
export default class ModuleManager extends EventEmitter {
  private _npmFolder: string | undefined
  private _yarnFolder: string | undefined
  private taskId = 1
  private installing:Map<number, string> = new Map()
  private disables:string[] = []
  private workspace:any

  constructor() {
    super()
    let workspace = this.workspace = require('../workspace').default
    workspace.emitter.on('terminalResult', (res:TerminalResult) => {
      if (!res.id) return
      let {id} = res
      if (res.success && this.installing.has(id)) {
        this.emit('installed', this.installing.get(id))
      }
      this.installing.delete(id)
    })
  }

  private get nvim():Neovim {
    return this.workspace.nvim
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

  public async installModule(mod: string, section?:string):Promise<number> {
    let mods = Array.from(this.installing.values())
    if (mods.indexOf(mod) !== -1) return
    if (this.disables.indexOf(mod) !== -1) return
    let {nvim} = this
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
        let config = this.workspace.getConfiguration(section)
        config.update('enable', false, true)
        echoMessage(nvim, `${section} disabled`)
      }
      return
    }
    this.installing.set(id, mod)
    this.taskId = this.taskId + 1
    let pre = isLinux ? 'sudo ' : ''
    let cmd = idx == 0 ? `${pre} npm install -g ${mod}` : `yarn global add ${mod}`
    await nvim.call('coc#util#open_terminal', [{id, cmd}])
    return id
  }
}
