import { Autocmd, Env } from '../types'
import ContentProvider from './contentProvider'
import os from 'os'
import fs from 'fs-extra'
import path from 'path'
import { Neovim } from '@chemzqm/neovim'
import { disposeAll, platform } from '../util'
import { Disposable } from 'vscode-languageserver-protocol'
import Watchers from './watchers'
const logger = require('../util/logger')('core-autocmds')

export default class Autocmds implements Disposable {
  private _dynAutocmd = false
  private autocmdMaxId = 0
  public readonly autocmds: Map<number, Autocmd> = new Map()
  private nvim: Neovim
  private env: Env
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

  public attach(nvim: Neovim, env: Env): void {
    this.nvim = nvim
    this.env = env
  }

  public async doAutocmd(id: number, args: any[]): Promise<void> {
    let autocmd = this.autocmds.get(id) as any
    if (autocmd) await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
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
    if (!force && !this._dynAutocmd) return
    this._dynAutocmd = true
    let schemes = this.contentProvider.schemes
    let cmds: string[] = []
    for (let scheme of schemes) {
      cmds.push(`autocmd BufReadCmd,FileReadCmd,SourceCmd ${scheme}:/* call coc#rpc#request('CocAutocmd', ['BufReadCmd','${scheme}', expand('<amatch>')])`)
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
    if (this.nvim.hasFunction('nvim_exec')) {
      this.nvim.exec(content, false).logError()
    } else {
      let dir = path.join(process.env.TMPDIR || os.tmpdir(), `coc.nvim-${process.pid}`)
      if (!fs.existsSync(dir)) fs.mkdirpSync(dir)
      let filepath = path.join(dir, `coc-${process.pid}.vim`)
      fs.writeFileSync(filepath, content, 'utf8')
      let cmd = `source ${filepath}`
      if (this.env.isCygwin && platform.isWindows) {
        cmd = `execute "source" . substitute(system('cygpath ${filepath.replace(/\\/g, '/')}'), '\\n', '', 'g')`
      }
      this.nvim.command(cmd).logError()
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
    if (this.nvim.hasFunction('nvim_exec')) {
      let content = 'augroup coc_dynamic_autocmd\n  autocmd!\naugroup end'
      this.nvim.exec(content, false).logError()
    }
  }
}
