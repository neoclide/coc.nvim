'use strict'
import { Neovim } from '@chemzqm/neovim'
import { createLogger } from '../logger'
import { Autocmd } from '../types'
import { disposeAll } from '../util'
import { fs, os, path } from '../util/node'
import * as platform from '../util/platform'
import { Disposable } from '../util/protocol'
import ContentProvider from './contentProvider'
import { has } from './funcs'
import Watchers from './watchers'
const logger = createLogger('core-autocmds')

interface PartialEnv {
  isCygwin: boolean
  isVim: boolean
  version: string
}

export default class Autocmds implements Disposable {
  private _dynAutocmd = false
  private _disposed = false
  private autocmdMaxId = 0
  public readonly autocmds: Map<number, Autocmd> = new Map()
  private nvim: Neovim
  private env: PartialEnv
  private disposables: Disposable[] = []
  constructor(
    private contentProvider: ContentProvider,
    private watchers: Watchers
  ) {
    this.contentProvider.onDidProviderChange(() => {
      this.setupDynamicAutocmd()
    }, null, this.disposables)
    this.watchers.onDidOptionChange(() => {
      this.setupDynamicAutocmd()
    }, null, this.disposables)
  }

  public attach(nvim: Neovim, env: PartialEnv): void {
    this.nvim = nvim
    this.env = env
  }

  public async doAutocmd(id: number, args: any[]): Promise<void> {
    let autocmd = this.autocmds.get(id)
    if (autocmd) {
      await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
    }
  }

  public registerAutocmd(autocmd: Autocmd): Disposable {
    this.autocmdMaxId += 1
    let id = this.autocmdMaxId
    this.autocmds.set(id, autocmd)
    this.setupDynamicAutocmd()
    return Disposable.create(() => {
      this.autocmds.delete(id)
      this.setupDynamicAutocmd()
    })
  }

  public setupDynamicAutocmd(force = false): void {
    if ((!force && !this._dynAutocmd) || this._disposed) return
    this._dynAutocmd = true
    let schemes = this.contentProvider.schemes
    let cmds: string[] = []
    for (let scheme of schemes) {
      cmds.push(`autocmd BufReadCmd,FileReadCmd,SourceCmd ${scheme}:/* call coc#rpc#request('CocAutocmd', ['BufReadCmd','${scheme}', expand('<afile>')])`)
    }
    for (let [id, autocmd] of this.autocmds.entries()) {
      let args = autocmd.arglist && autocmd.arglist.length ? ', ' + autocmd.arglist.join(', ') : ''
      let event = Array.isArray(autocmd.event) ? autocmd.event.join(',') : autocmd.event
      let pattern = autocmd.pattern != null ? autocmd.pattern : '*'
      if (/\buser\b/i.test(event)) {
        pattern = ''
      }
      cmds.push(`autocmd ${event} ${pattern} call coc#rpc#${autocmd.request ? 'request' : 'notify'}('doAutocmd', [${id}${args}])`)
    }
    for (let key of this.watchers.options) {
      cmds.push(`autocmd OptionSet ${key} call coc#rpc#notify('OptionSet',[expand('<amatch>'), v:option_old, v:option_new])`)
    }
    let content = `
augroup coc_dynamic_autocmd
  autocmd!
  ${cmds.join('\n  ')}
augroup end`
    if (this.env && has(this.env, 'nvim-0.5.0')) {
      this.nvim.call('nvim_exec', [content, 0], true)
    } else {
      let dir = path.join(process.env.TMPDIR || os.tmpdir(), `coc.nvim-${process.pid}`)
      fs.mkdirSync(dir, { recursive: true })
      let filepath = path.join(dir, `coc-${process.pid}.vim`)
      fs.writeFileSync(filepath, content, 'utf8')
      let cmd = `source ${filepath}`
      if (this.env.isCygwin && platform.isWindows) {
        cmd = `execute "source" . substitute(system('cygpath ${filepath.replace(/\\/g, '/')}'), '\\n', '', 'g')`
      }
      this.nvim.command(cmd, true)
    }
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.nvim.command(`augroup coc_dynamic_autocmd|  autocmd!|augroup end`, true)
    disposeAll(this.disposables)
  }
}
