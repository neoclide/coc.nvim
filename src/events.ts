import { Disposable } from 'vscode-languageserver-protocol'
import { PopupChangeEvent, VimCompleteItem } from './types'
import { disposeAll } from './util'
import workspace from './workspace'
const logger = require('./util/logger')('events')

export type Result = void | Promise<void>

export type BufEvents = 'TextChangedI' | 'BufHidden' | 'BufEnter' | 'TextChanged'
  | 'BufWritePost' | 'CursorHold' | 'InsertLeave' | 'TermOpen' | 'TermClose' | 'InsertEnter'
  | 'BufCreate' | 'BufUnload' | 'BufWritePre' | 'CursorHoldI' | 'TextChangedP' | 'Enter'

export type EmptyEvents = 'FocusGained'

export type TextChangedEvent = 'TextChanged'

export type TaskEvents = 'TaskExit' | 'TaskStderr' | 'TaskStdout'

export type AllEvents = BufEvents | EmptyEvents | MoveEvents | TaskEvents |
  'CompleteDone' | 'MenuPopupChanged' | 'InsertCharPre' | 'FileType' |
  'BufWinEnter' | 'BufWinLeave' | 'VimResized' | 'DirChanged' | 'OptionSet' |
  'Command' | 'BufReadCmd' | 'GlobalChange' | 'InputChar'

export type MoveEvents = 'CursorMoved' | 'CursorMovedI'

export type OptionValue = string | number | boolean

export interface CursorPosition {
  bufnr: number
  lnum: number
  col: number
  insert: boolean
}

class Events {

  private handlers: Map<string, Function[]> = new Map()
  private _cursor: CursorPosition
  private insertMode = false

  public get cursor(): CursorPosition {
    return this._cursor
  }

  public async fire(event: string, args: any[]): Promise<void> {
    logger.debug('Event:', event, args)
    let handlers = this.handlers.get(event)
    if (event == 'InsertEnter') {
      this.insertMode = true
    } else if (event == 'InsertLeave') {
      this.insertMode = false
    } else if (!this.insertMode && (event == 'CursorHoldI' || event == 'CursorMovedI')) {
      this.insertMode = true
      await this.fire('InsertEnter', [args[0]])
    } else if (this.insertMode && (event == 'CursorHold' || event == 'CursorMoved')) {
      this.insertMode = false
      await this.fire('InsertLeave', [args[0]])
    }
    if (event == 'CursorMoved' || event == 'CursorMovedI') {
      this._cursor = {
        bufnr: args[0],
        lnum: args[1][0],
        col: args[1][1],
        insert: event == 'CursorMovedI'
      }
    }
    if (handlers) {
      try {
        await Promise.all(handlers.map(fn => {
          return Promise.resolve(fn.apply(null, args))
        }))
      } catch (e) {
        logger.error(`Error on ${event}: `, e.stack)
        workspace.showMessage(`Error on ${event}: ${e.message} `, 'error')
      }
    }
  }

  public on(event: EmptyEvents | AllEvents[], handler: () => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: BufEvents, handler: (bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: MoveEvents, handler: (bufnr: number, cursor: [number, number]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: TextChangedEvent, handler: (bufnr: number, changedtick: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TaskExit', handler: (id: string, code: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TaskStderr' | 'TaskStdout', handler: (id: string, lines: string[]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'BufReadCmd', handler: (scheme: string, fullpath: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'VimResized', handler: (columns: number, lines: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'Command', handler: (name: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'MenuPopupChanged', handler: (event: PopupChangeEvent, cursorline: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'CompleteDone', handler: (item: VimCompleteItem) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'InsertCharPre', handler: (character: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'FileType', handler: (filetype: string, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'BufWinEnter' | 'BufWinLeave', handler: (bufnr: number, winid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'DirChanged', handler: (cwd: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'OptionSet' | 'GlobalChange', handler: (option: string, oldVal: OptionValue, newVal: OptionValue) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'InputChar', handler: (character: string, mode: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
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
