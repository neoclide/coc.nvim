'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from '../util/protocol'
import events from '../events'
import { disposeAll } from '../util'
import { omitUndefined } from '../util/object'
import { toText } from '../util/string'

export interface InputPreference {
  placeHolder?: string
  position?: 'cursor' | 'center'
  marginTop?: number
  border?: [0 | 1, 0 | 1, 0 | 1, 0 | 1]
  rounded?: boolean
  minWidth?: number
  maxWidth?: number
  highlight?: string
  borderhighlight?: string
  /**
   * map list key-mappings
   */
  list?: boolean
}

export interface Dimension {
  width: number
  height: number
  row: number
  col: number
}

type RequestResult = [number, number, [number, number, number, number]]

export default class InputBox implements Disposable {
  private disposables: Disposable[] = []
  private _winid: number | undefined
  private _bufnr: number | undefined
  private _input: string
  private accepted = false
  private _disposed = false
  public title: string
  public loading: boolean
  public value: string
  public borderhighlight: string
  // width, height, row, col
  private _dimension: [number, number, number, number] = [0, 0, 0, 0]
  private readonly _onDidFinish = new Emitter<string>()
  private readonly _onDidChange = new Emitter<string>()
  private clear = false
  public readonly onDidFinish: Event<string | null> = this._onDidFinish.event
  public readonly onDidChange: Event<string> = this._onDidChange.event
  constructor(private nvim: Neovim, defaultValue: string) {
    this._input = defaultValue
    this.disposables.push(this._onDidFinish)
    this.disposables.push(this._onDidChange)
    let _title: string | undefined
    Object.defineProperty(this, 'title', {
      set: (newTitle: string) => {
        _title = newTitle
        if (this._winid) nvim.call('coc#dialog#change_title', [this._winid, newTitle], true)
      },
      get: () => {
        return _title
      }
    })
    let _loading = false
    Object.defineProperty(this, 'loading', {
      set: (loading: boolean) => {
        _loading = loading
        if (this._winid) nvim.call('coc#dialog#change_loading', [this._winid, loading], true)
      },
      get: () => {
        return _loading
      }
    })
    let _borderhighlight: string
    Object.defineProperty(this, 'borderhighlight', {
      set: (borderhighlight: string) => {
        _borderhighlight = borderhighlight
        if (this._winid) nvim.call('coc#dialog#change_border_hl', [this._winid, borderhighlight], true)
      },
      get: () => {
        return _borderhighlight
      }
    })
    Object.defineProperty(this, 'value', {
      set: (value: string) => {
        value = toText(value)
        if (value !== this._input) {
          this.clearVirtualText()
          this._input = value
          this.nvim.call('coc#dialog#change_input_value', [this.winid, this.bufnr, value], true)
          this._onDidChange.fire(value)
        }
      },
      get: () => {
        return this._input
      }
    })
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this._bufnr) {
        this._winid = undefined
        this.dispose()
      }
    }, null, this.disposables)
    events.on('PromptInsert', (value, bufnr) => {
      if (bufnr == this._bufnr) {
        this._input = value
        this.accepted = true
        this.dispose()
      }
    }, null, this.disposables)
    events.on('TextChangedI', (bufnr, info) => {
      if (bufnr == this._bufnr && this._input !== info.line) {
        this.clearVirtualText()
        this._input = info.line
        this._onDidChange.fire(info.line)
      }
    }, null, this.disposables)
  }

  private clearVirtualText(): void {
    if (this.clear && this.bufnr) {
      this.clear = false
      let buf = this.nvim.createBuffer(this.bufnr)
      buf.clearNamespace('input-box')
    }
  }

  public get dimension(): Dimension | undefined {
    let { _dimension } = this
    return { width: _dimension[0], height: _dimension[1], row: _dimension[2], col: _dimension[3] }
  }

  public get bufnr(): number | undefined {
    return this._bufnr
  }

  public get winid(): number | undefined {
    return this._winid
  }

  public async show(title: string, preferences: InputPreference): Promise<boolean> {
    this.title = title
    this.borderhighlight = preferences.borderhighlight ?? 'CocFloating'
    this.loading = false
    if (preferences.placeHolder && !this._input && !this.nvim.isVim) {
      this.clear = true
    }
    let config = omitUndefined(preferences)
    let res = await this.nvim.call('coc#dialog#create_prompt_win', [title, this._input, config]) as RequestResult
    if (!res) throw new Error('Unable to open input window')
    this._bufnr = res[0]
    this._winid = res[1]
    this._dimension = res[2]
    return true
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.nvim.call('coc#float#close', [this._winid ?? -1], true)
    this._onDidFinish.fire(this.accepted ? this._input : null)
    this._winid = undefined
    this._bufnr = undefined
    disposeAll(this.disposables)
  }
}
