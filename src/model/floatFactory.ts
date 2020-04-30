import { Buffer, Neovim, Window } from '@chemzqm/neovim'
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
  private window: Window
  private mutex: Mutex
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  private tokenSource: CancellationTokenSource
  private alignTop = false
  private pumAlignTop = false
  private creating = false
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
      if (!this.winid || this.creating) return
      if (this.buffer && bufnr == this.buffer.id) return
      if (bufnr == this.targetBufnr) return
      this.close()
    }, null, this.disposables)
    events.on('InsertLeave', bufnr => {
      if (!this.winid || this.creating) return
      if (this.buffer && bufnr == this.buffer.id) return
      if (snippetsManager.isActived(bufnr)) return
      this.close()
    }, null, this.disposables)
    events.on('MenuPopupChanged', async (ev, cursorline) => {
      let pumAlignTop = this.pumAlignTop = cursorline > ev.row
      if (pumAlignTop == this.alignTop) {
        this.close()
      }
    }, null, this.disposables)
    events.on('CursorMoved', bufnr => {
      if (!this.winid || this.creating) return
      this.onCursorMoved(false, bufnr)
    }, null, this.disposables)
    events.on('CursorMovedI', this.onCursorMoved.bind(this, true), null, this.disposables)
  }

  private onCursorMoved(insertMode: boolean, bufnr: number): void {
    if (!this.window || this.buffer && bufnr == this.buffer.id) return
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
    let { floatBuffer, nvim } = this
    let bufnr = floatBuffer ? floatBuffer.buffer.id : 0
    let arr = await this.nvim.call('coc#util#create_float_buf', [bufnr])
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
    let maxWidth = this.maxWidth
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
    // Ensure the floating window isn't tiny if the cursor is on the right:
    // increase the offset to accommodate some minimum width.
    // If we have offsetX, precise positioning is intended, force exact width.
    let minWidth = offsetX ? width : Math.min(width, 50, maxWidth)
    offsetX = Math.min(col - 1, offsetX)
    if (col - offsetX + minWidth > columns) {
      offsetX = col - offsetX + minWidth - columns
    }
    this.alignTop = alignTop
    return {
      height: alignTop ? Math.max(1, Math.min(row, height)) : Math.max(1, Math.min(height, (lines - row))),
      width: Math.min(columns, width),
      row: alignTop ? - height : 1,
      col: offsetX == 0 ? 0 : - offsetX,
      relative: 'cursor',
      style: 'minimal'
    }
  }
  public async create(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<void> {
    if (!workspace.floatSupported) {
      logger.error('Floating window & textprop not supported!')
      return
    }
    this.creating = true
    this.cancel()
    let release = await this.mutex.acquire()
    try {
      let ts = Date.now()
      let shown = await this.createPopup(docs, allowSelection, offsetX)
      if (!shown) this.close()
      logger.debug(`Float window cost:`, (Date.now() - ts) + 'ms')
      logger.debug('shown:', shown)
      this.creating = false
      release()
    } catch (e) {
      logger.error(`Error on create popup:`, e.message)
      this.creating = false
      release()
    }
  }

  private async createPopup(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<boolean> {
    if (docs.length == 0) return false
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    this.floatBuffer = await this.createFloatBuffer()
    let config = await this.attachDocuments(docs, offsetX)
    if (token.isCancellationRequested) return false
    let { nvim, alignTop, pumAlignTop } = this
    let mode = await this.nvim.call('coc#util#get_float_mode', [allowSelection, alignTop, pumAlignTop])
    if (!mode || !config || token.isCancellationRequested) return false
    let winid = await this.nvim.call('coc#util#create_float_win', [this.winid, this.buffer.id, config, false])
    if (!winid || token.isCancellationRequested) return false
    logger.debug('create_float_win:', winid)
    this.window = nvim.createWindow(winid)
    let showBottom = alignTop && docs.length > 1
    nvim.pauseNotification()
    if (workspace.isNvim) {
      nvim.command(`noa call win_gotoid(${this.winid})`, true)
      this.floatBuffer.setLines()
      nvim.command(`normal! ${showBottom ? 'G' : 'gg'}0`, true)
      nvim.command('noa wincmd p', true)
    } else {
      let filetypes = distinct(docs.map(d => d.filetype))
      if (filetypes.length == 1) {
        this.floatBuffer.setFiletype(filetypes[0])
      }
      // no need to change cursor position
      this.floatBuffer.setLines(this.winid)
      nvim.call('win_execute', [this.winid, `normal! ${showBottom ? 'G' : 'gg'}0`], true)
      nvim.command('redraw', true)
    }
    let [, err] = await nvim.resumeNotification()
    if (err) throw new Error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
    if (mode == 's') {
      await snippetsManager.selectCurrentPlaceholder(false)
      await wait(50)
    }
    return true
  }

  /**
   * Close float window
   */
  public close(): void {
    let { winid } = this
    this.cancel()
    if (winid) {
      if (workspace.isNvim) {
        this.window.close(true, true)
      } else {
        this.nvim.call('popup_close', [winid], true)
        this.nvim.command('redraw', true)
      }
      this.window = null
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

  public get winid(): number {
    return this.window ? this.window.id : 0
  }

  public get buffer(): Buffer {
    return this.floatBuffer ? this.floatBuffer.buffer : null
  }
}
