import { Disposable } from 'vscode-languageserver-protocol'
import { VimCompleteItem } from './types'
import workspace from './workspace'
import { disposeAll } from './util'
const logger = require('./util/logger')('events')

export type Result = void | Promise<void>

export type BufEvents = 'TextChangedI' | 'BufHidden' | 'BufEnter'
  | 'TextChanged' | 'BufWritePost' | 'CursorMoved' | 'CursorHold'
  | 'BufCreate' | 'BufUnload' | 'BufWritePre'

export type EmptyEvents = 'InsertLeave' | 'InsertEnter' | 'TextChangedP' | 'CursorMovedI'

export type AllEvents = BufEvents | EmptyEvents | 'CompleteDone' | 'InsertCharPre' | 'FileType' | 'BufWinEnter' | 'DirChanged' | 'OptionSet' | 'Command' | 'toggle'

export type OptionValue = string | number | boolean

class Events {

  private handlers: Map<string, Function[]> = new Map()

  public async fire(event: string, args: any[]): Promise<void> {
    logger.debug('Autocmd:', event, args)
    let handlers = this.handlers.get(event)
    if (handlers) {
      try {
        await Promise.all(handlers.map(fn => {
          return Promise.resolve(fn.apply(null, args))
        }))
      } catch (e) {
        workspace.showMessage(`Error on ${event}: ${e.message}`, 'error')
      }
    }
  }

  public on(event: EmptyEvents | AllEvents[], handler: () => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: BufEvents, handler: (bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'toggle', handler: (enabled: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'Command', handler: (name: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'CompleteDone', handler: (item: VimCompleteItem) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'InsertCharPre', handler: (character: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'FileType', handler: (filetype: string, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'BufWinEnter', handler: (bufnr: number, winid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'DirChanged', handler: (cwd: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'OptionSet', handler: (option: string, oldVal: OptionValue, newVal: OptionValue) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: AllEvents[] | AllEvents, handler: (...args: any[]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable {
    if (Array.isArray(event)) {
      let disposables: Disposable[] = []
      for (let ev of event) {
        disposables.push(this.on(ev as any, handler, thisArg, disposables))
      }
      return Disposable.create(() => {
        disposeAll(disposables)
      })
    } else {
      let arr = this.handlers.get(event) || []
      arr.push(handler.bind(thisArg || null))
      this.handlers.set(event, arr)
      let disposable = Disposable.create(() => {
        let idx = arr.indexOf(handler)
        if (idx !== -1) {
          arr.splice(idx, 1)
        }
      })
      if (disposables) {
        disposables.push(disposable)
      }
      return disposable
    }
  }
}
export default new Events()
