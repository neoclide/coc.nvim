import { Disposable } from 'vscode-languageserver-protocol'
import { PopupChangeEvent, InsertChange, VimCompleteItem } from './types'
import { disposeAll } from './util'
import { equals } from './util/object'
const logger = require('./util/logger')('events')

export type Result = void | Promise<void>

export type BufEvents = 'BufHidden' | 'BufEnter' | 'BufWritePost'
  | 'CursorHold' | 'InsertLeave' | 'TermOpen' | 'TermClose' | 'InsertEnter'
  | 'BufCreate' | 'BufUnload' | 'BufWritePre' | 'CursorHoldI' | 'Enter'

export type EmptyEvents = 'FocusGained'

export type InsertChangeEvents = 'TextChangedP' | 'TextChangedI'

export type TaskEvents = 'TaskExit' | 'TaskStderr' | 'TaskStdout'

export type WindowEvents = 'WinLeave' | 'WinEnter'

export type AllEvents = BufEvents | EmptyEvents | MoveEvents | TaskEvents | WindowEvents
  | InsertChangeEvents | 'CompleteDone' | 'TextChanged' | 'MenuPopupChanged'
  | 'InsertCharPre' | 'FileType' | 'BufWinEnter' | 'BufWinLeave' | 'VimResized'
  | 'DirChanged' | 'OptionSet' | 'Command' | 'BufReadCmd' | 'GlobalChange' | 'InputChar'
  | 'WinLeave' | 'MenuInput' | 'PromptInsert'

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
    let cbs = this.handlers.get(event)
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
      let cursor = {
        bufnr: args[0],
        lnum: args[1][0],
        col: args[1][1],
        insert: event == 'CursorMovedI'
      }
      // not handle CursorMoved when it's not moved at all
      if (this._cursor && equals(this._cursor, cursor)) return
      this._cursor = cursor
    }
    if (cbs) {
      try {
        await Promise.all(cbs.map(fn => fn(args)))
      } catch (e) {
        if (e.message && e.message.indexOf('transport disconnected') == -1) {
          console.error(`Error on ${event}: ${e.message}${e.stack ? '\n' + e.stack : ''} `)
        }
        logger.error(`Handler Error on ${event}`, e.stack)
      }
    }
  }

  public on(event: EmptyEvents | AllEvents[], handler: () => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: BufEvents, handler: (bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: MoveEvents, handler: (bufnr: number, cursor: [number, number]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: InsertChangeEvents, handler: (bufnr: number, info: InsertChange) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: WindowEvents, handler: (winid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TextChanged', handler: (bufnr: number, changedtick: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
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
  public on(event: 'InputChar' | 'MenuInput', handler: (character: string, mode: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'PromptInsert', handler: (value: string, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: AllEvents[] | AllEvents, handler: (...args: any[]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable {
    if (Array.isArray(event)) {
      let arr = disposables || []
      for (let ev of event) {
        this.on(ev as any, handler, thisArg, arr)
      }
      return Disposable.create(() => {
        disposeAll(arr)
      })
    } else {
      let arr = this.handlers.get(event) || []
      let stack = Error().stack
      let wrappedhandler = args => new Promise((resolve, reject) => {
        let timer
        try {
          Promise.resolve(handler.apply(thisArg || null, args)).then(() => {
            if (timer) clearTimeout(timer)
            resolve()
          }, e => {
            if (timer) clearTimeout(timer)
            reject(e)
          })
          timer = setTimeout(() => {
            logger.warn(`Handler of ${event} blocked more than 2s:`, stack)
          }, 2000)
        } catch (e) {
          reject(e)
        }
      })
      arr.push(wrappedhandler)
      this.handlers.set(event, arr)
      let disposable = Disposable.create(() => {
        let idx = arr.indexOf(wrappedhandler)
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
