'use strict'
import type { Neovim } from '@chemzqm/neovim'
import events from '../events'
import { createLogger } from '../logger'
import { ProviderResult } from '../provider'
import { Env } from '../types'
import { disposeAll } from '../util'
import { Disposable, Emitter, Event } from '../util/protocol'
import { toErrorText } from '../util/string'
const logger = createLogger('watchers')

export default class Watchers implements Disposable {
  private nvim: Neovim
  private env: Env
  private optionCallbacks: Map<string, Set<(oldValue: any, newValue: any) => ProviderResult<void>>> = new Map()
  private globalCallbacks: Map<string, Set<(oldValue: any, newValue: any) => ProviderResult<void>>> = new Map()
  private disposables: Disposable[] = []
  private _onDidRuntimePathChange = new Emitter<string[]>()
  public readonly onDidRuntimePathChange: Event<string[]> = this._onDidRuntimePathChange.event
  constructor() {
    events.on('OptionSet', async (changed: string, oldValue: any, newValue: any) => {
      let cbs = Array.from(this.optionCallbacks.get(changed) ?? [])
      await Promise.allSettled(cbs.map(cb => {
        return (async () => {
          try {
            await Promise.resolve(cb(oldValue, newValue))
          } catch (e) {
            this.nvim.errWriteLine(`Error on OptionSet '${changed}': ${toErrorText(e)}`)
            logger.error(`Error on OptionSet callback:`, e)
          }
        })()
      }))
    }, null, this.disposables)
    events.on('GlobalChange', async (changed: string, oldValue: any, newValue: any) => {
      let cbs = Array.from(this.globalCallbacks.get(changed) ?? [])
      await Promise.allSettled(cbs.map(cb => {
        return (async () => {
          try {
            await Promise.resolve(cb(oldValue, newValue))
          } catch (e) {
            this.nvim.errWriteLine(`Error on GlobalChange '${changed}': ${toErrorText(e)}`)
            logger.error(`Error on GlobalChange callback:`, e)
          }
        })()
      }))
    }, null, this.disposables)
  }

  public get options(): string[] {
    return Array.from(this.optionCallbacks.keys())
  }

  public attach(nvim: Neovim, env: Env): void {
    this.nvim = nvim
    this.env = env
    this.watchOption('runtimepath', (oldValue: string, newValue: string) => {
      let oldList: string[] = oldValue.split(',')
      let newList: string[] = newValue.split(',')
      let paths = newList.filter(x => !oldList.includes(x))
      if (paths.length > 0) {
        this._onDidRuntimePathChange.fire(paths)
      }
      this.env.runtimepath = newValue
    }, this.disposables)
  }

  /**
   * Watch for option change.
   */
  public watchOption(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): Disposable {
    let cbs = this.optionCallbacks.get(key)
    if (!cbs) {
      cbs = new Set()
      this.optionCallbacks.set(key, cbs)
    }
    cbs.add(callback)
    let cmd = `autocmd! coc_dynamic_option OptionSet ${key} call coc#rpc#notify('OptionSet',[expand('<amatch>'), v:option_old, v:option_new])`
    this.nvim.command(cmd, true)
    let disposable = Disposable.create(() => {
      let cbs = this.optionCallbacks.get(key)
      cbs.delete(callback)
      if (cbs.size === 0) this.nvim.command(`autocmd! coc_dynamic_option OptionSet ${key}`, true)
    })
    if (disposables) disposables.push(disposable)
    return disposable
  }

  /**
   * Watch global variable, works on neovim only.
   */
  public watchGlobal(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): Disposable {
    let { nvim } = this
    let cbs = this.globalCallbacks.get(key)
    if (!cbs) {
      cbs = new Set()
      this.globalCallbacks.set(key, cbs)
    }
    cbs.add(callback)
    nvim.call('coc#_watch', key, true)
    let disposable = Disposable.create(() => {
      let cbs = this.globalCallbacks.get(key)
      cbs.delete(callback)
      if (cbs.size === 0) nvim.call('coc#_unwatch', key, true)
    })
    if (disposables) disposables.push(disposable)
    return disposable
  }

  public dispose(): void {
    disposeAll(this.disposables)
    this._onDidRuntimePathChange.dispose()
  }
}
