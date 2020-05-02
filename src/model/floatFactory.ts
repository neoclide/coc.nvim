import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Mutex } from '../util/mutex'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import snippetsManager from '../snippets/manager'
import { Documentation, Env } from '../types'
import { disposeAll, wait } from '../util'
import workspace from '../workspace'
import FloatBuffer from './floatBuffer'
import { distinct } from '../util/array'
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
  relative: 'cursor' | 'win' | 'editor'
  style?: string
}

// factory class for floating window
export default class FloatFactory implements Disposable {
  private targetBufnr: number
  private winid: number
  private mutex: Mutex
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  private tokenSource: CancellationTokenSource
  private alignTop = false
  private pumAlignTop = false
  private onCursorMoved: (() => void) & { clear(): void }
  constructor(private nvim: Neovim,
    private env: Env,
    private preferTop = false,
    private maxHeight = 999,
    private maxWidth?: number,
    private autoHide = true) {
    if (!workspace.floatSupported) return
    this.mutex = new Mutex()
    this.maxWidth = Math.min(maxWidth || 80, this.columns - 10)
    events.on('BufEnter', bufnr => {
      if (bufnr == this.bufnr
        || bufnr == this.targetBufnr) return
      this.close()
    }, null, this.disposables)
    events.on('MenuPopupChanged', async (ev, cursorline) => {
      let pumAlignTop = this.pumAlignTop = cursorline > ev.row
      if (pumAlignTop == this.alignTop) {
        this.close()
      }
    }, null, this.disposables)
    this.onCursorMoved = debounce(this._onCursorMoved.bind(this), 300)
    events.on('CursorMoved', this.onCursorMoved, null, this.disposables)
    events.on('CursorMovedI', this.onCursorMoved, null, this.disposables)
  }

  private _onCursorMoved(): void {
    let { bufnr, insertMode } = workspace
    if (bufnr == this.bufnr) return
    if (this.autoHide) {
      this.close()
      return
    }
    if (!insertMode || bufnr != this.targetBufnr) {
      this.close()
      return
    }
  }

  private async createFloatBuffer(): Promise<FloatBuffer> {
    let { nvim } = this
    let arr = await nvim.call('coc#util#create_float_buf', [this.bufnr])
    this.targetBufnr = arr[0]
    return arr[1] ? new FloatBuffer(nvim, nvim.createBuffer(arr[1])) : null
  }

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public async attachDocuments(docs: Documentation[], offsetX = 0): Promise<WindowConfig> {
    let { nvim, preferTop } = this
    let { columns, lines } = this
    let alignTop = false
    let [row, col] = await nvim.call('coc#util#win_position') as [number, number]
    let maxWidth = Math.min(this.maxWidth, columns)
    let height = this.floatBuffer.getHeight(docs, maxWidth)
    height = Math.min(height, this.maxHeight)
    if (!preferTop) {
      if (lines - row < height && row > height) {
        alignTop = true
      }
    } else {
      if (row >= height || row >= lines - row) {
        alignTop = true
      }
    }
    if (alignTop) docs.reverse()
    await this.floatBuffer.setDocuments(docs, maxWidth)
    let { width } = this.floatBuffer
    if (col - offsetX + width > columns) {
      offsetX = col + width - columns
    }
    this.alignTop = alignTop
    return {
      height: alignTop ? Math.max(1, Math.min(row, height)) : Math.max(1, Math.min(height, (lines - row))),
      width,
      row: alignTop ? - height : 1,
      col: offsetX == 0 ? 0 : - offsetX,
      relative: 'cursor'
    }
  }

  public async create(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<void> {
    if (!workspace.floatSupported) return
    this.onCursorMoved.clear()
    if (docs.length == 0) {
      this.close()
      return
    }
    this.cancel()
    let release = await this.mutex.acquire()
    try {
      await this.createPopup(docs, allowSelection, offsetX)
      release()
    } catch (e) {
      logger.error(`Error on create popup:`, e.message)
      this.close()
      release()
    }
  }

  public async createPopup(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<void> {
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    this.floatBuffer = await this.createFloatBuffer()
    let config = await this.attachDocuments(docs, offsetX)
    if (!config || token.isCancellationRequested) return
    let { nvim, alignTop, pumAlignTop } = this
    let mode = await this.nvim.call('coc#util#get_float_mode', [allowSelection, alignTop, pumAlignTop])
    if (!mode || token.isCancellationRequested) return
    let winid = this.winid = await this.nvim.call('coc#util#create_float_win', [this.winid, this.bufnr, config])
    if (!winid || token.isCancellationRequested) return
    let showBottom = alignTop && docs.length > 1
    nvim.pauseNotification()
    if (workspace.isNvim) {
      nvim.command(`noa call win_gotoid(${this.winid})`, true)
      this.floatBuffer.setLines()
      nvim.command(`noa normal! ${showBottom ? 'G' : 'gg'}0`, true)
      nvim.command('noa wincmd p', true)
    } else {
      // no need to change cursor position
      this.floatBuffer.setLines(this.winid)
      nvim.call('win_execute', [this.winid, `noa normal! ${showBottom ? 'G' : 'gg'}0`], true)
      let filetypes = distinct(docs.map(d => d.filetype))
      if (filetypes.length == 1) {
        nvim.call('win_execute', [winid, `setfiletype ${filetypes[0]}`], true)
      }
      nvim.command('redraw', true)
    }
    let [, err] = await nvim.resumeNotification()
    if (err) throw new Error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
    if (mode == 's') {
      await snippetsManager.selectCurrentPlaceholder(false)
      await wait(50)
    }
    this.onCursorMoved.clear()
  }

  /**
   * Close float window
   */
  public close(): void {
    let { winid } = this
    this.cancel()
    if (winid) {
      this.nvim.call('coc#util#close_win', [winid], true)
      if (workspace.isVim) this.nvim.command('redraw', true)
      this.winid = 0
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
    if (this.tokenSource) {
      this.tokenSource.cancel()
    }
    disposeAll(this.disposables)
  }

  public get bufnr(): number {
    return this.floatBuffer ? this.floatBuffer.buffer.id : 0
  }
}
