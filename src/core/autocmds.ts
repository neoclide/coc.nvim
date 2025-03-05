'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Autocmd } from '../types'
import { isFalsyOrEmpty } from '../util/array'
import { Disposable } from '../util/protocol'
import { crypto } from '../util/node'

interface PartialEnv {
  isVim: boolean
  version: string
}

const groupPrefix = 'coc_dynamic_'

export function getAutoCmdText(autocmd: Autocmd): string {
  let { arglist, pattern, request, callback } = autocmd
  let res = ''
  res += Array.isArray(autocmd.event) ? autocmd.event.join(' ') + ' ' : autocmd.event + ' '
  if (pattern) res += pattern + ' '
  if (request) res += 'request '
  if (Array.isArray(arglist)) res += arglist.join(' ') + ' '
  res += callback.toString()
  return res
}

export default class Autocmds implements Disposable {
  public readonly autocmds: Map<string, Autocmd> = new Map()
  private nvim: Neovim
  private env: PartialEnv

  public attach(nvim: Neovim, env: PartialEnv): void {
    this.nvim = nvim
    this.env = env
  }

  // unique id for autocmd to create unique group name
  public generateId(autocmd: Autocmd): string {
    let text = getAutoCmdText(autocmd)
    return groupPrefix + crypto.createHash('md5').update(text).digest('hex')
  }

  public async doAutocmd(id: string, args: any[]): Promise<void> {
    let autocmd = this.autocmds.get(id)
    if (autocmd) await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
  }

  public registerAutocmd(autocmd: Autocmd): Disposable {
    // Used as group name as well
    let id = this.generateId(autocmd)
    let { nvim } = this
    this.autocmds.set(id, autocmd)
    nvim.pauseNotification()
    let cmd = createCommand(id, autocmd)
    nvim.command('augroup ' + id, true)
    nvim.command(`autocmd!`, true)
    nvim.command(cmd, true)
    nvim.command('augroup END', true)
    nvim.resumeNotification(false, true)
    return Disposable.create(() => {
      nvim.command(`autocmd! ${id}`, true)
    })
  }

  public resetDynamicAutocmd(): void {
    let { nvim } = this
    nvim.pauseNotification()
    for (let [id, autocmd] of this.autocmds.entries()) {
      nvim.command(`autocmd! ${id}`, true)
      nvim.command(createCommand(id, autocmd), true)
    }
    nvim.resumeNotification(false, true)
  }

  public dispose(): void {
    this.autocmds.clear()
  }
}

export function createCommand(id: string, autocmd: Autocmd): string {
  let args = isFalsyOrEmpty(autocmd.arglist) ? '' : ', ' + autocmd.arglist.join(', ')
  let event = Array.isArray(autocmd.event) ? autocmd.event.join(',') : autocmd.event
  let pattern = autocmd.pattern != null ? autocmd.pattern : '*'
  if (/\buser\b/i.test(event)) {
    pattern = ''
  }
  let method = autocmd.request ? 'request' : 'notify'
  return `autocmd ${id} ${event} ${pattern} call coc#rpc#${method}('doAutocmd', ['${id}'${args}])`
}
