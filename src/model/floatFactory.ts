import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { parseDocuments } from '../markdown'
import { Documentation, Env } from '../types'
import { disposeAll } from '../util'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
const isVim = process.env.VIM_NODE_RPC == '1'
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
  autoHide?: boolean
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
export default class FloatFactory implements Disposable {
  private targetBufnr: number
  private winid = 0
  private _bufnr = 0
  private mutex: Mutex = new Mutex()
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  private alignTop = false
  private pumAlignTop = false
  private cursor: [number, number]
  private onCursorMoved: ((bufnr: number, cursor: [number, number]) => void) & { clear(): void }
  constructor(
    private nvim: Neovim,
    /**
     * @deprecated not used any more
     */
    private env: Env,
    private preferTop = false,
    /**
     * @deprecated pass maxHeight by `show()` instead.
     */
    private maxHeight?: number,
    /**
     * @deprecated pass maxWidth by `show()` instead.
     */
    private maxWidth?: number,
    private autoHide = true) {
    this.mutex = new Mutex()
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
    this.onCursorMoved.clear()
    if (docs.length == 0 || docs.every(doc => doc.content.length == 0)) {
      this.close()
      return
    }
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

  /**
   * Show documentations in float window/popup
   *
   * @param docs List of documentations.
   * @param config Configuration for floating window/popup.
   */
  public async show(docs: Documentation[], config: FloatWinConfig = {}): Promise<void> {
    this.onCursorMoved.clear()
    if (docs.length == 0 || docs.every(doc => doc.content.length == 0)) {
      this.close()
      return
    }
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
    docs = docs.filter(o => o.content.trim().length > 0)
    let { lines, codes, highlights } = parseDocuments(docs)
    let config: any = {
      allowSelection: opts.allowSelection || false,
      pumAlignTop: this.pumAlignTop,
      preferTop: typeof opts.preferTop === 'boolean' ? opts.preferTop : this.preferTop,
      offsetX: opts.offsetX || 0,
      title: opts.title || '',
      close: opts.close ? 1 : 0,
      codes,
      highlights
    }
    if (opts.maxHeight || this.maxHeight) {
      config.maxHeight = opts.maxHeight || this.maxHeight
    }
    if (opts.maxWidth || this.maxWidth) {
      config.maxWidth = opts.maxWidth || this.maxWidth
    }
    if (opts.border && !opts.border.every(o => o == 0)) {
      config.border = opts.border
    }
    if (opts.title && !config.border) {
      config.border = [1, 1, 1, 1]
    }
    if (opts.highlight) config.highlight = opts.highlight
    if (opts.borderhighlight) config.borderhighlight = [opts.borderhighlight]
    if (opts.cursorline) config.cursorline = 1
    if (this.autoHide && !opts.autoHide === false) config.autohide = 1
    let arr = await this.nvim.call('coc#float#create_cursor_float', [this.winid, this._bufnr, lines, config])
    if (!arr || arr.length == 0) {
      this.winid = null
      return
    }
    let [targetBufnr, cursor, winid, bufnr] = arr as [number, [number, number], number, number]
    this.winid = winid
    if (token.isCancellationRequested) {
      this.close()
      return
    }
    this._bufnr = bufnr
    this.tokenSource.dispose()
    this.tokenSource = null
    this.targetBufnr = targetBufnr
    this.cursor = cursor
    this.onCursorMoved.clear()
  }

  /**
   * Close float window
   */
  public close(): void {
    let { winid, nvim } = this
    this.cancel()
    if (winid) {
      this.winid = 0
      // TODO: sometimes this won't work at all
      nvim.pauseNotification()
      nvim.call('coc#float#close', [winid], true)
      if (isVim) this.nvim.command('redraw', true)
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
