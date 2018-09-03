import { Disposable } from 'vscode-languageserver-protocol'
import { VimCompleteItem } from './types'
import workspace from './workspace'
const logger = require('./util/logger')('events')

export type Result = void | Promise<void>

export type BufEvents = 'TextChangedI' | 'BufHidden' | 'BufEnter'
  | 'TextChanged' | 'BufWritePost' | 'CursorMoved' | 'CursorHold'
  | 'BufCreate' | 'BufUnload' | 'BufWritePre'

export type EmptyEvents = 'InsertLeave' | 'InsertEnter' | 'TextChangedP' | 'CursorMovedI'

export type AllEvents = BufEvents | EmptyEvents | 'CompleteDone' | 'InsertCharPre' | 'FileType' | 'BufWinEnter' | 'DirChanged' | 'OptionSet'

export type OptionValue = string | number | boolean

class Events {

  private handlers: Map<string, Function[]> = new Map()

  // @ts-ignore
  private async fire(event: string, args: any[]): Promise<void> {
    logger.debug('Autocmd:', event, args)
    let handlers = this.handlers.get(event)
    if (handlers) {
      for (let fn of handlers) {
        try {
          await Promise.resolve(fn.apply(null, args))
        } catch (e) {
          workspace.showMessage(`Error on ${event}: ${e.message}`, 'error')
        }
      }
    }
  }

  public on(event: EmptyEvents, handler: () => Result, thisArg?: any): Disposable
  public on(event: BufEvents, handler: (bufnr: number) => Result, thisArg?: any): Disposable
  public on(event: 'CompleteDone', handler: (item: VimCompleteItem) => Result, thisArg?: any): Disposable
  public on(event: 'InsertCharPre', handler: (character: string) => Result, thisArg?: any): Disposable
  public on(event: 'FileType', handler: (filetype: string, bufnr: number) => Result, thisArg?: any): Disposable
  public on(event: 'BufWinEnter', handler: (filename: string, winid: number) => Result, thisArg?: any): Disposable
  public on(event: 'DirChanged', handler: (cwd: string) => Result, thisArg?: any): Disposable
  public on(event: 'OptionSet', handler: (option: string, oldVal: OptionValue, newVal: OptionValue) => Result, thisArg?: any): Disposable
  public on(event: AllEvents, handler: (...args: any[]) => Result, thisArg?: any): Disposable {
    let arr = this.handlers.get(event) || []
    arr.push(handler.bind(thisArg || null))
    this.handlers.set(event, arr)
    return Disposable.create(() => {
      let idx = arr.indexOf(handler)
      if (idx !== -1) {
        arr.splice(idx, 1)
      }
    })
  }
}
export default new Events()
