import { Neovim } from '@chemzqm/neovim'
import { EventEmitter } from 'events'
import path from 'path'
import { TerminalResult } from '../types'
import { executable, runCommand } from '../util'
import { statAsync } from '../util/fs'
import workspace from '../workspace'
const logger = require('../util/logger')('model-terminal')

const isLinux = process.platform === 'linux'

// manage global modules
export default class Terminal extends EventEmitter {
  private _npmFolder: string | undefined
  private _yarnFolder: string | undefined
  private installing: Set<string> = new Set()

  constructor(private nvim: Neovim) {
    super()
  }

  private get nodeFolder(): Promise<string> {
    if (this._npmFolder) return Promise.resolve(this._npmFolder)
    return this.nvim.call('coc#util#module_folder', 'npm').then(folder => {
      this._npmFolder = folder
      return folder
    })
  }

  private get yarnFolder(): Promise<string> {
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

  public async installModule(mod: string): Promise<string> {
    if (this.installing.has(mod)) return
    let items = [
      'Use npm to install',
      'Use yarn to install'
    ]
    let idx = await workspace.showQuickpick(items, `${mod} not found, choose action by number`)
    // cancel
    if (idx == -1) return
    this.installing.add(mod)
    let pre = isLinux ? 'sudo ' : ''
    let cmd = idx == 0 ? `${pre} npm install -g ${mod}` : `yarn global add ${mod}`
    if (idx == 1 && !executable('yarn')) {
      try {
        await runCommand('curl --compressed -o- -L https://yarnpkg.com/install.sh | bash', process.cwd())
      } catch (e) {
        workspace.showMessage(e.message, 'error')
        return
      }
    }
    try {
      await runCommand(cmd, process.cwd())
    } catch (e) {
      workspace.showMessage(e.message, 'error')
      return
    }
    return await this.resolveModule(mod)
  }

  public async runCommand(cmd: string, cwd?: string): Promise<TerminalResult> {
    return await this.nvim.callAsync('coc#util#run_terminal', { cmd, cwd }) as TerminalResult
  }
}
