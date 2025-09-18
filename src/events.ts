'use strict'
import type { CompleteDoneItem, CompleteOption } from './completion/types'
import { createLogger } from './logger'
import { JumpInfo } from './types'
import { disposeAll, getConditionValue } from './util'
import { onUnexpectedError, shouldIgnore } from './util/errors'
import * as Is from './util/is'
import { equals } from './util/object'
import { CancellationToken, Disposable } from './util/protocol'
import { byteSlice } from './util/string'
const logger = createLogger('events')
const debounceTime = getConditionValue(100, 10)

export type Result = void | Promise<void>

export interface PopupChangeEvent {
  readonly startcol: number
  readonly index: number
  readonly word: string
  readonly height: number
  readonly width: number
  readonly row: number
  readonly col: number
  readonly size: number
  readonly scrollbar: boolean
  readonly inserted: boolean
  readonly move: boolean
}

export interface VisibleEvent {
  winid: number
  bufnr: number
  /**
   * 1 based, end inclusive topline, botline
   */
  region: [number, number]
}

export interface ModeChangedEvent {
  readonly old_mode: string
  readonly new_mode: string
}

export interface InsertChange {
  readonly lnum: number
  readonly col: number
  readonly line: string
  readonly changedtick: number
  pre: string
  /**
   * Insert character that cause change of this time.
   */
  insertChar?: string
  insertChars?: string[]
}

export enum EventName {
  Ready = 'ready',
  InsertEnter = 'InsertEnter',
  InsertLeave = 'InsertLeave',
  CursorHoldI = 'CursorHoldI',
  CursorMovedI = 'CursorMovedI',
  CursorHold = 'CursorHold',
  CursorMoved = 'CursorMoved',
  MenuPopupChanged = 'MenuPopupChanged',
  InsertCharPre = 'InsertCharPre',
  TextChanged = 'TextChanged',
  BufEnter = 'BufEnter',
  TextChangedI = 'TextChangedI',
  TextChangedP = 'TextChangedP',
  TextInsert = 'TextInsert',
  BufWinEnter = 'BufWinEnter',
  WinScrolled = 'WinScrolled',
  WinClosed = 'WinClosed',
  BufWinLeave = 'BufWinLeave',
  ModeChanged = 'ModeChanged'
}

export type BufEvents = 'BufHidden' | 'BufEnter' | 'BufRename'
  | 'InsertLeave' | 'TermOpen' | 'InsertEnter' | 'BufCreate' | 'BufUnload'
  | 'BufDetach' | 'Enter' | 'LinesChanged' | 'PumNavigate'

export type EmptyEvents = 'FocusGained' | 'ColorScheme' | 'FocusLost' | 'InsertSnippet' | 'VimLeavePre' | 'ready'

export type InsertChangeEvents = 'TextChangedP' | 'TextChangedI'

export type TaskEvents = 'TaskExit' | 'TaskStderr' | 'TaskStdout'

export type WindowEvents = 'WinLeave' | 'WinEnter' | 'WinClosed'

export type TabEvents = 'TabNew' | 'TabClosed'

export type AllEvents = BufEvents | EmptyEvents | CursorEvents | TaskEvents | WindowEvents | TabEvents
  | InsertChangeEvents | 'CompleteDone' | 'TextChanged' | 'MenuPopupChanged' | 'BufWritePost' | 'BufWritePre' | 'ModeChanged'
  | 'InsertCharPre' | 'FileType' | 'BufWinEnter' | 'BufWinLeave' | 'VimResized' | 'TermExit' | 'WinScrolled' | 'CompleteStart'
  | 'DirChanged' | 'OptionSet' | 'Command' | 'BufReadCmd' | 'GlobalChange' | 'InputChar' | 'PlaceholderJump' | 'InputListSelect'
  | 'WinLeave' | 'MenuInput' | 'PromptInsert' | 'PromptExit' | 'FloatBtnClick' | 'InsertSnippet' | 'TextInsert' | 'PromptKeyPress' | 'WindowVisible'

export type CursorEvents = CursorHoldEvents | CursorMoveEvents
export type CursorHoldEvents = 'CursorHold' | 'CursorHoldI'
export type CursorMoveEvents = 'CursorMoved' | 'CursorMovedI'

export type OptionValue = string | number | boolean

export interface CursorPosition {
  readonly bufnr: number
  readonly lnum: number
  readonly col: number
  readonly insert: boolean
}

export interface LatestInsert {
  readonly bufnr: number
  readonly character: string
  readonly timestamp: number
}

class Events {

  private handlers: Map<string, ((...args: any[]) => Promise<unknown>)[]> = new Map()
  private _cursor: CursorPosition
  private _bufnr = 1
  private timeoutMap: Map<number, NodeJS.Timeout> = new Map()
  // bufnr & character
  private _recentInserts: [number, string][] = []
  private _lastChange = 0
  private _insertMode = false
  private _pumAlignTop = false
  private _pumVisible = false
  private _completing = false
  private _requesting = false
  private _ready = false
  private _mode = 'n'
  private _pumInserted = false
  public timeout = 1000
  // public completing = false

  public set requesting(val: boolean) {
    this._requesting = val
  }

  public get requesting(): boolean {
    return this._requesting
  }

  public get ready(): boolean {
    return this._ready
  }

  public get mode(): string {
    return this._mode
  }

  public get pumInserted(): boolean {
    return this._pumInserted
  }

  private fireVisibleEvent(ev: VisibleEvent): void {
    let { winid } = ev
    let timer = this.timeoutMap.get(winid)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      this.fire('WindowVisible', [ev]).catch(onUnexpectedError)
    }, debounceTime)
    this.timeoutMap.set(winid, timer)
  }

  private clearVisibleTimer(winid: number): void {
    let timer = this.timeoutMap.get(winid)
    if (timer) {
      this.timeoutMap.delete(winid)
      clearTimeout(timer)
    }
  }

  public set completing(completing: boolean) {
    this._completing = completing
    this._pumVisible = completing
    this._pumInserted = false
  }

  public get completing(): boolean {
    return this._completing
  }

  public get cursor(): CursorPosition {
    return this._cursor ?? { bufnr: this._bufnr, col: 1, lnum: 1, insert: false }
  }

  public get bufnr(): number {
    return this._bufnr
  }

  public get pumvisible(): boolean {
    return this._pumVisible
  }

  public get pumAlignTop(): boolean {
    return this._pumAlignTop
  }

  public get insertMode(): boolean {
    return this._insertMode && this._mode.startsWith('i')
  }

  public get lastChangeTs(): number {
    return this._lastChange
  }

  /**
   * Resolved when first event fired or timeout
   */
  public race(events: AllEvents[], token?: number | CancellationToken): Promise<{ name: AllEvents, args: unknown[] } | undefined> {
    let disposables: Disposable[] = []
    return new Promise(resolve => {
      if (Is.number(token)) {
        let timer = setTimeout(() => {
          disposeAll(disposables)
          resolve(undefined)
        }, token)
        disposables.push(Disposable.create(() => {
          clearTimeout(timer)
        }))
      } else if (CancellationToken.is(token)) {
        token.onCancellationRequested(() => {
          disposeAll(disposables)
          resolve(undefined)
        }, null, disposables)
      }
      events.forEach(ev => {
        this.on(ev, (...args) => {
          disposeAll(disposables)
          resolve({ name: ev, args })
        }, null, disposables)
      })
    })
  }

  public async fire(event: string, args: any[]): Promise<void> {
    if (event === EventName.Ready) {
      this._ready = true
    } else if (event == EventName.InsertEnter) {
      this._insertMode = true
    } else if (event == EventName.InsertLeave) {
      this._insertMode = false
      this._pumVisible = false
      this._recentInserts = []
    } else if (event == EventName.CursorHoldI || event == EventName.CursorMovedI) {
      this._bufnr = args[0]
      if (!this._insertMode) {
        this._insertMode = true
        void this.fire(EventName.InsertEnter, [args[0]])
      }
    } else if (event == EventName.CursorHold || event == EventName.CursorMoved) {
      this._bufnr = args[0]
      if (this._insertMode) {
        this._insertMode = false
        void this.fire(EventName.InsertLeave, [args[0]])
      }
    } else if (event == EventName.MenuPopupChanged) {
      this._pumVisible = true
      this._pumAlignTop = args[1] > args[0].row
      this._pumInserted = args[0].inserted
    } else if (event == EventName.InsertCharPre) {
      this._recentInserts.push([args[1], args[0]])
    } else if (event == EventName.TextChanged) {
      this._lastChange = Date.now()
    } else if (event == EventName.BufEnter) {
      this._bufnr = args[0]
    } else if (event == EventName.TextChangedI || event == EventName.TextChangedP) {
      let info: InsertChange = args[1]
      let pre = byteSlice(info.line ?? '', 0, info.col - 1)
      let arr: [number, string][]
      arr = this._recentInserts.filter(o => o[0] == args[0])
      this._bufnr = args[0]
      this._recentInserts = []
      this._lastChange = Date.now()
      info.pre = pre
      info.insertChars = arr.map(o => o[1])
      // fix cursor since vim may not send CursorMovedI event
      this._cursor = Object.freeze({
        bufnr: args[0],
        lnum: info.lnum,
        col: info.col,
        insert: true
      })
      if (arr.length && pre.length) {
        let character = pre.slice(-1)
        if (arr.findIndex(o => o[1] == character) !== -1) {
          info.insertChar = character
          // make it fires after TextChangedI & TextChangedP
          process.nextTick(() => {
            void this.fire(EventName.TextInsert, [...args, character])
          })
        }
      }
    } else if (event == EventName.BufWinEnter) {
      const [bufnr, winid, region] = args
      this.fireVisibleEvent({ bufnr, winid, region })
    } else if (event == EventName.WinScrolled) {
      const [winid, bufnr, region] = args
      this.fireVisibleEvent({ bufnr, winid, region })
    } else if (event == EventName.WinClosed) {
      this.clearVisibleTimer(args[0])
    } else if (event == EventName.BufWinLeave) {
      this.clearVisibleTimer(args[1])
    } else if (event == EventName.ModeChanged) {
      this._mode = args[0].new_mode
    }
    if (event == EventName.CursorMoved || event == EventName.CursorMovedI) {
      args.push(this._recentInserts.length > 0)
      let cursor = {
        bufnr: args[0],
        lnum: args[1][0],
        col: args[1][1],
        insert: event == EventName.CursorMovedI
      }
      // Avoid CursorMoved event when it's not moved at all
      if ((this._cursor && equals(this._cursor, cursor))) return
      this._cursor = cursor
    }
    let cbs = this.handlers.get(event)
    if (cbs?.length) {
      let fns = cbs.slice()
      let traceSlow = this.requesting
      await Promise.allSettled(fns.map(fn => {
        let promiseFn = async () => {
          let timer: NodeJS.Timeout
          if (traceSlow) {
            timer = setTimeout(() => {
              logger.warn(`Slow "${event}" handler detected`, fn['stack'])
            }, this.timeout)
          }
          try {
            await fn(args)
          } catch (e) {
            if (!shouldIgnore(e)) logger.error(`Error on event: ${event}`, e, fn['stack'])
          }
          clearTimeout(timer)
        }
        return promiseFn()
      }))
    }
  }

  public on(event: BufEvents | 'PromptExit', handler: (bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: CursorHoldEvents, handler: (bufnr: number, cursor: [number, number], winid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: InsertChangeEvents, handler: (bufnr: number, info: InsertChange) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: WindowEvents, handler: (winid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: CursorMoveEvents, handler: (bufnr: number, cursor: [number, number], hasInsert: boolean) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'WindowVisible', handler: (event: VisibleEvent) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'WinScrolled', handler: (winid: number, bufnr: number, region: Readonly<[number, number]>) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TabClosed', handler: (tabids: number[]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TabNew', handler: (tabid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TextInsert', handler: (bufnr: number, info: InsertChange, character: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'FloatBtnClick', handler: (bufnr: number, index: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'PromptKeyPress', handler: (bufnr: number, key: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'BufWritePre', handler: (bufnr: number, bufname: string, changedtick: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TextChanged' | 'BufWritePost', handler: (bufnr: number, changedtick: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TaskExit', handler: (id: string, code: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TaskStderr' | 'TaskStdout', handler: (id: string, lines: string[]) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'BufReadCmd', handler: (scheme: string, fullpath: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'VimResized', handler: (columns: number, lines: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'Command', handler: (name: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'MenuPopupChanged', handler: (event: PopupChangeEvent, cursorline: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'CompleteDone', handler: (item: CompleteDoneItem | object, line: number, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'CompleteStart', handler: (option: Readonly<CompleteOption>) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'InsertCharPre', handler: (character: string, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'FileType', handler: (filetype: string, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'BufWinEnter' | 'BufWinLeave', handler: (bufnr: number, winid: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'TermExit', handler: (bufnr: number, status: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'DirChanged', handler: (cwd: string) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'OptionSet' | 'GlobalChange', handler: (option: string, oldVal: OptionValue, newVal: OptionValue) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'InputChar', handler: (session: string, character: string, mode: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'PromptInsert', handler: (value: string, bufnr: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'PlaceholderJump', handler: (bufnr: number, info: JumpInfo) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'InputListSelect', handler: (index: number) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: 'ModeChanged', handler: (event: ModeChangedEvent) => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: EmptyEvents, handler: () => Result, thisArg?: any, disposables?: Disposable[]): Disposable
  public on(event: AllEvents | AllEvents[], handler: (...args: unknown[]) => Result, thisArg?: any, disposables?: Disposable[] | true): Disposable
  public on(event: AllEvents[] | AllEvents, handler: (...args: any[]) => Result, thisArg?: any, disposables?: Disposable[] | true): Disposable {
    if (Array.isArray(event)) {
      let arr: Disposable[] = []
      for (let ev of event) {
        this.on(ev as any, handler, thisArg, arr)
      }
      let dis = Disposable.create(() => {
        disposeAll(arr)
      })
      if (Array.isArray(disposables)) {
        disposables.push(dis)
      }
      return dis
    } else {
      let arr = this.handlers.get(event) ?? []
      let onFinish = () => {
        if (disposables === true && disposable) disposable.dispose()
      }
      let wrappedhandler = args => new Promise((resolve, reject) => {
        try {
          Promise.resolve(handler.apply(thisArg ?? null, args)).then(() => {
            onFinish()
            resolve(undefined)
          }, (e: Error) => {
            onFinish()
            reject(e)
          })
        } catch (e) {
          onFinish()
          reject(e as Error)
        }
      })
      Error.captureStackTrace(wrappedhandler)
      arr.push(wrappedhandler)
      this.handlers.set(event, arr)
      let disposable = Disposable.create(() => {
        let idx = arr.indexOf(wrappedhandler)
        if (idx !== -1) {
          arr.splice(idx, 1)
        }
      })
      if (Array.isArray(disposables)) {
        disposables.push(disposable)
      }
      return disposable
    }
  }

  public once(event: AllEvents, handler: (...args: any[]) => Result, thisArg?: any): Disposable {
    return this.on(event, handler, thisArg, true)
  }
}

export default new Events()
