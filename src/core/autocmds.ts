'use strict'
import { Neovim } from '@chemzqm/neovim'
import { createLogger } from '../logger'
import { Autocmd } from '../types'
import { isFalsyOrEmpty } from '../util/array'
import { parseExtensionName } from '../util/extensionRegistry'
import { omit } from '../util/lodash'
import { Disposable } from '../util/protocol'
const logger = createLogger('autocmds')

interface PartialEnv {
  isVim: boolean
  version: string
}

interface AutocmdOption {
  group?: string | number
  pattern?: string | string[]
  buffer?: number
  desc?: string
  command?: string
  once?: boolean
  nested?: boolean
  replace?: boolean
}

export interface AutocmdOptionWithStack extends Autocmd {
  stack: string
}

export class AutocmdItem {
  private _extensiionName: string | undefined
  constructor(
    public readonly id: number,
    public readonly option: AutocmdOptionWithStack
  ) {
  }

  public get extensiionName(): string {
    if (this._extensiionName) return this._extensiionName
    this._extensiionName = parseExtensionName(this.option.stack)
    return this._extensiionName
  }
}

const groupName = 'coc_dynamic_autocmd'

export function toAutocmdOption(item: AutocmdItem): AutocmdOption {
  let { id, option } = item
  let opt: AutocmdOption = { group: groupName }
  if (option.buffer) opt.buffer = option.buffer
  if (option.pattern) opt.pattern = option.pattern
  if (option.once) opt.once = true
  if (option.nested) opt.nested = true
  let method = option.request ? 'request' : 'notify'
  let args = isFalsyOrEmpty(option.arglist) ? '' : ', ' + option.arglist.join(', ')
  let command = `call coc#rpc#${method}('doAutocmd', [${id}${args}])`
  opt.command = command
  return opt
}

export default class Autocmds implements Disposable {
  public readonly autocmds: Map<number, AutocmdItem> = new Map()
  private nvim: Neovim
  private env: PartialEnv
  private id = 0

  public attach(nvim: Neovim, env: PartialEnv): void {
    this.nvim = nvim
    this.env = env
  }

  public async doAutocmd(id: number, args: any[]): Promise<void> {
    let autocmd = this.autocmds.get(id)
    if (autocmd) {
      let option = autocmd.option
      // TODO add timeout limit for request
      // autocmd.option.request
      logger.trace(`Invoke autocmd from "${autocmd.extensiionName}"`, option)
      try {
        await Promise.resolve(option.callback.apply(option.thisArg, args))
      } catch (e) {
        e['stack'] = autocmd.option.stack
        logger.error(`Error on autocmd "${option.event}"`, omit(option, ['callback', 'stack']), e)
      }
    }
  }

  public registerAutocmd(autocmd: AutocmdOptionWithStack): Disposable {
    // Used as group name as well
    let id = ++this.id
    let item = new AutocmdItem(id, autocmd)
    this.autocmds.set(id, item)
    this.createAutocmd(item)
    return Disposable.create(() => {
      // only remove the item from autocmds
      this.autocmds.delete(id)
    })
  }

  private createAutocmd(item: AutocmdItem): void {
    let { option } = item
    let event = Array.isArray(option.event) ? option.event.join(',') : option.event
    if (/\buser\b/i.test(event)) {
      let cmd = createCommand(item.id, event, option)
      this.nvim.command(cmd, true)
    } else {
      let opt = toAutocmdOption(item)
      this.nvim.createAutocmd(item.option.event, opt, true)
    }
  }

  public removeExtensionAutocmds(extensiionName: string): void {
    let { nvim, autocmds } = this
    nvim.pauseNotification()
    nvim.command(`autocmd! ${groupName}`, true)
    let items = autocmds.values()
    for (const item of items) {
      if (item.extensiionName === extensiionName) {
        autocmds.delete(item.id)
        continue
      }
      this.createAutocmd(item)
    }
    nvim.resumeNotification(false, true)
  }

  public dispose(): void {
    this.autocmds.clear()
  }
}

/**
 * Only used for user autocmd, which can't be used for nvim_create_autocmd
 */
export function createCommand(id: number, event: string, autocmd: Autocmd): string {
  let args = isFalsyOrEmpty(autocmd.arglist) ? '' : ', ' + autocmd.arglist.join(', ')
  let method = autocmd.request ? 'request' : 'notify'
  let opt = ''
  if (autocmd.once) opt += ' ++once'
  if (autocmd.nested) opt += ' ++nested'
  return `autocmd ${groupName} ${event}${opt}  call coc#rpc#${method}('doAutocmd', [${id}${args}])`
}
