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
  private winid = 0
  private bufnr = 0
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
    this.floatBuffer = new FloatBuffer(nvim)
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

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public getWindowConfig(docs: Documentation[], win_position: [number, number], offsetX = 0): WindowConfig {
    let { columns, preferTop, lines } = this
    let alignTop = false
    let [row, col] = win_position
    if ((preferTop && row >= 3) || (!preferTop && row >= lines - row - 1)) {
      alignTop = true
    }
    let maxHeight = alignTop ? row : lines - row - 1
    maxHeight = Math.min(maxHeight, this.maxHeight || lines)
    let maxWidth = Math.min(this.maxWidth || 80, 80, columns)
    let { width, height } = FloatBuffer.getDimension(docs, maxWidth, maxHeight)
    if (col - offsetX + width > columns) {
      offsetX = col + width - columns
    }
    this.alignTop = alignTop
    return {
      height,
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
    let { nvim, alignTop, pumAlignTop, floatBuffer } = this
    // get options
    let arr = await this.nvim.call('coc#util#get_float_mode', [allowSelection, alignTop, pumAlignTop])
    if (!arr || token.isCancellationRequested) return
    let [mode, targetBufnr, win_position] = arr
    this.targetBufnr = targetBufnr
    let config = this.getWindowConfig(docs, win_position, offsetX)
    // calculat highlights
    await floatBuffer.setDocuments(docs, config.width)
    if (token.isCancellationRequested) return
    // create window
    let res = await this.nvim.call('coc#util#create_float_win', [this.winid, this.bufnr, config])
    if (!res || token.isCancellationRequested) return
    let winid = this.winid = res[0]
    let bufnr = this.bufnr = res[1]
    let showBottom = alignTop && docs.length > 1
    nvim.pauseNotification()
    if (workspace.isNvim) {
      nvim.command(`noa call win_gotoid(${this.winid})`, true)
      this.floatBuffer.setLines(bufnr)
      nvim.command(`noa normal! ${showBottom ? 'G' : 'gg'}0`, true)
      nvim.command('noa wincmd p', true)
    } else {
      // no need to change cursor position
      this.floatBuffer.setLines(bufnr, winid)
      nvim.call('win_execute', [winid, `noa normal! ${showBottom ? 'G' : 'gg'}0`], true)
      nvim.command('redraw', true)
    }
    let [, err] = await nvim.resumeNotification()
    if (err) throw new Error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
    if (mode == 's' && !token.isCancellationRequested) {
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
}
