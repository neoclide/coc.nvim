import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { EventEmitter } from 'events'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { Documentation, Env } from '../types'
import { disposeAll, wait } from '../util'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
import FloatBuffer from './floatBuffer'
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
  relative: 'cursor' | 'win' | 'editor'
  style?: string
  cursorline?: number
  title?: string
  border?: number[]
  autohide?: number
  close?: number
}

export interface FloatWinConfig {
  allowSelection?: boolean
  offsetX?: number
  title?: string
  border?: number[]
  cursorline?: boolean
  close?: boolean
  preferTop?: boolean
  highlight?: string
  borderhighlight?: string
  maxHeight?: number
  maxWidth?: number
}

export interface ViewportConfig {
  lines: number
  columns: number
  cmdheight: number
}

// factory class for floating window
export default class FloatFactory extends EventEmitter implements Disposable {
  private targetBufnr: number
  private winid = 0
  private _bufnr = 0
  private mutex: Mutex = new Mutex()
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  private tokenSource: CancellationTokenSource
  private alignTop = false
  private pumAlignTop = false
  private cursor: [number, number]
  private onCursorMoved: ((bufnr: number, cursor: [number, number]) => void) & { clear(): void }
  constructor(private nvim: Neovim,
    private env: Env,
    private preferTop = false,
    private maxHeight?: number,
    private maxWidth?: number,
    private autoHide = true) {
    super()
    this.floatBuffer = new FloatBuffer(nvim)
    events.on('BufEnter', bufnr => {
      if (bufnr == this._bufnr
        || bufnr == this.targetBufnr) return
      this.close()
    }, null, this.disposables)
    events.on('InsertEnter', bufnr => {
      if (bufnr == this._bufnr) return
      this.close()
    })
    events.on('MenuPopupChanged', (ev, cursorline) => {
      let pumAlignTop = this.pumAlignTop = cursorline > ev.row
      if (pumAlignTop == this.alignTop) {
        this.close()
      }
    }, null, this.disposables)
    events.on('BufWinLeave', bufnr => {
      if (this.bufnr == bufnr) {
        this.emit('close')
      }
    }, null, this.disposables)
    this.onCursorMoved = debounce(this._onCursorMoved.bind(this), 200)
    events.on('CursorMoved', this.onCursorMoved.bind(this, false), null, this.disposables)
    events.on('CursorMovedI', this.onCursorMoved.bind(this, true), null, this.disposables)
    this.disposables.push(Disposable.create(() => {
      this.onCursorMoved.clear()
      this.cancel()
    }))
  }

  private _onCursorMoved(insertMode: boolean, bufnr: number, cursor: [number, number]): void {
    if (bufnr == this._bufnr) return
    if (bufnr == this.targetBufnr && equals(cursor, this.cursor)) {
      // cursor not moved
      return
    }
    if (this.autoHide) {
      this.close()
      return
    }
    if (!insertMode || bufnr != this.targetBufnr) {
      this.close()
      return
    }
  }

  /**
   * @deprecated use show method instead
   */
  public async create(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<void> {
    let { floating, textprop } = this.env
    if (!floating && !textprop) return
    this.onCursorMoved.clear()
    if (docs.length == 0 || docs.every(doc => doc.content.length == 0)) {
      this.close()
      return
    }
    this.cancel()
    let release = await this.mutex.acquire()
    try {
      await this.createPopup(docs, { allowSelection, offsetX })
      release()
    } catch (e) {
      release()
      logger.error(`Error on create popup:`, e.message)
      this.close()
    }
  }

  public async show(docs: Documentation[], config: FloatWinConfig = {}): Promise<void> {
    let { floating, textprop } = this.env
    if (!floating && !textprop) return
    this.onCursorMoved.clear()
    if (docs.length == 0 || docs.every(doc => doc.content.length == 0)) {
      this.close()
      return
    }
    this.cancel()
    let release = await this.mutex.acquire()
    try {
      await this.createPopup(docs, config)
      release()
    } catch (e) {
      release()
      logger.error(`Error on create popup:`, e.message)
      this.close()
    }
  }

  private async createPopup(docs: Documentation[], opts: FloatWinConfig): Promise<void> {
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let { nvim, floatBuffer } = this
    let lines = FloatBuffer.getLines(docs, !this.env.isVim)
    let floatConfig: any = {
      allowSelection: opts.allowSelection || false,
      pumAlignTop: this.pumAlignTop,
      preferTop: typeof opts.preferTop === 'boolean' ? opts.preferTop : this.preferTop,
      offsetX: opts.offsetX || 0,
      title: opts.title || ''
    }
    if (opts.maxHeight || this.maxHeight) {
      floatConfig.maxHeight = opts.maxHeight || this.maxHeight
    }
    if (opts.maxWidth || this.maxWidth) {
      floatConfig.maxWidth = opts.maxWidth || this.maxWidth
    }
    if (opts.border) {
      floatConfig.border = opts.border
    }
    if (opts.title && !floatConfig.border) {
      floatConfig.border = [1, 1, 1, 1]
    }
    let arr = await this.nvim.call('coc#float#get_float_mode', [lines, floatConfig])
    if (!arr || token.isCancellationRequested) return
    let [mode, targetBufnr, cursor, config] = arr
    config.relative = 'cursor'
    config.title = floatConfig.title
    config.border = floatConfig.border
    config.close = opts.close ? 1 : 0
    if (opts.highlight) {
      config.highlight = opts.highlight
    }
    if (opts.borderhighlight) {
      config.borderhighlight = [opts.borderhighlight]
    }
    if (opts.cursorline) config.cursorline = 1
    if (this.autoHide) config.autohide = 1
    this.targetBufnr = targetBufnr
    this.cursor = cursor
    // calculat highlights
    await floatBuffer.setDocuments(docs, config.width)
    if (token.isCancellationRequested) return
    if (mode == 's') nvim.call('feedkeys', ['\x1b', "in"], true)
    // create window
    let res = await this.nvim.call('coc#float#create_float_win', [this.winid, this._bufnr, config])
    if (!res) return
    this.onCursorMoved.clear()
    let winid = this.winid = res[0] as number
    let bufnr = this._bufnr = res[1] as number
    if (token.isCancellationRequested) return
    nvim.pauseNotification()
    if (!this.env.isVim) {
      nvim.call('coc#util#win_gotoid', [winid], true)
      this.floatBuffer.setLines(bufnr)
      nvim.call('coc#float#nvim_scrollbar', [winid], true)
      nvim.command('noa wincmd p', true)
    } else {
      // no need to change cursor position
      this.floatBuffer.setLines(bufnr, winid)
      nvim.command('redraw', true)
    }
    this.emit('show', winid, bufnr)
    let result = await nvim.resumeNotification()
    if (Array.isArray(result[1]) && result[1][0] == 0) {
      // invalid window
      this.winid = null
    }
    if (mode == 's' && !token.isCancellationRequested) {
      nvim.call('CocActionAsync', ['selectCurrentPlaceholder'], true)
      await wait(50)
    }
    this.onCursorMoved.clear()
  }

  /**
   * Close float window
   */
  public close(): void {
    let { winid, nvim } = this
    this.cancel()
    if (winid) {
      // TODO: sometimes this won't work at all
      nvim.pauseNotification()
      this.winid = 0
      nvim.call('coc#float#close', [winid], true)
      if (this.env.isVim) this.nvim.command('redraw', true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }
  }

  private cancel(): void {
    let { tokenSource } = this
    if (tokenSource) {
      tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.removeAllListeners()
    disposeAll(this.disposables)
  }

  public get bufnr(): number {
    return this._bufnr
  }

  public get buffer(): Buffer | null {
    return this.bufnr ? this.nvim.createBuffer(this.bufnr) : null
  }

  public get window(): Window | null {
    return this.winid ? this.nvim.createWindow(this.winid) : null
  }

  public async activated(): Promise<boolean> {
    if (!this.winid) return false
    return await this.nvim.call('coc#float#valid', [this.winid]) != 0
  }
}
