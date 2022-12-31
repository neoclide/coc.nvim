'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Autocmd } from '../types'
import { disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { Disposable } from '../util/protocol'

interface PartialEnv {
  isCygwin: boolean
  isVim: boolean
  version: string
}

let autocmdMaxId = 0
const groupName = 'coc_dynamic_autocmd'

export default class Autocmds implements Disposable {
  public readonly autocmds: Map<number, Autocmd> = new Map()
  private nvim: Neovim
  private env: PartialEnv
  private disposables: Disposable[] = []

  public attach(nvim: Neovim, env: PartialEnv): void {
    this.nvim = nvim
    this.env = env
  }

  public async doAutocmd(id: number, args: any[]): Promise<void> {
    let autocmd = this.autocmds.get(id)
    if (autocmd) await Promise.resolve(autocmd.callback.apply(autocmd.thisArg, args))
  }

  public registerAutocmd(autocmd: Autocmd): Disposable {
    autocmdMaxId += 1
    let id = autocmdMaxId
    this.autocmds.set(id, autocmd)
    this.nvim.command(createCommand(id, autocmd), true)
    return Disposable.create(() => {
      this.autocmds.delete(id)
      this.resetDynamicAutocmd()
    })
  }

  public resetDynamicAutocmd(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command(`autocmd! ${groupName}`, true)
    for (let [id, autocmd] of this.autocmds.entries()) {
      nvim.command(createCommand(id, autocmd), true)
    }
    nvim.resumeNotification(false, true)
  }

  public dispose(): void {
    this.nvim.command(`autocmd! ${groupName}`, true)
    disposeAll(this.disposables)
  }
}

export function createCommand(id: number, autocmd: Autocmd): string {
  let args = isFalsyOrEmpty(autocmd.arglist) ? '' : ', ' + autocmd.arglist.join(', ')
  let event = Array.isArray(autocmd.event) ? autocmd.event.join(',') : autocmd.event
  let pattern = autocmd.pattern != null ? autocmd.pattern : '*'
  if (/\buser\b/i.test(event)) {
    pattern = ''
  }
  let method = autocmd.request ? 'request' : 'notify'
  return `autocmd! ${groupName} ${event} ${pattern} call coc#rpc#${method}('doAutocmd', [${id}${args}])`
}
