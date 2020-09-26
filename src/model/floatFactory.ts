import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { EventEmitter } from 'events'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { Documentation, Env } from '../types'
import { disposeAll, wait } from '../util'
import { Mutex } from '../util/mutex'
import { equals } from '../util/object'
import { byteLength } from '../util/string'
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
}

// factory class for floating window
export default class FloatFactory extends EventEmitter implements Disposable {
  private targetBufnr: number
  private winid = 0
  private _bufnr = 0
  private mutex: Mutex
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
    private maxHeight = 999,
    private maxWidth?: number,
    private autoHide = true,
    private cursorline = false) {
    super()
    this.mutex = new Mutex()
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

  private getWindowConfig(docs: Documentation[], win_position: [number, number], offsetX = 0): WindowConfig {
    let { columns } = this.env
    let lines = this.env.lines - this.env.cmdheight - 1
    let { preferTop } = this
    let alignTop = false
    let [row, col] = win_position
    let max = this.getMaxWindowHeight(docs)
    if (preferTop && row >= max) {
      alignTop = true
    } else if (!preferTop && lines - row - 1 >= max) {
      alignTop = false
    } else if ((preferTop && row >= 3) || (!preferTop && row >= lines - row - 1)) {
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
      await this.createPopup(docs, allowSelection, offsetX)
      release()
    } catch (e) {
      logger.error(`Error on create popup:`, e.message)
      this.close()
      release()
    }
  }

  private async createPopup(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<void> {
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let { nvim, alignTop, pumAlignTop, floatBuffer } = this
    // get options
    let arr = await this.nvim.call('coc#util#get_float_mode', [allowSelection, alignTop, pumAlignTop])
    if (!arr || token.isCancellationRequested) return
    let [mode, targetBufnr, win_position, cursor] = arr
    this.targetBufnr = targetBufnr
    this.cursor = cursor
    let config = this.getWindowConfig(docs, win_position, offsetX)
    if (this.env.isVim && this.cursorline) {
      config.cursorline = 1
    }
    // calculat highlights
    await floatBuffer.setDocuments(docs, config.width)
    if (token.isCancellationRequested) return
    if (mode == 's') nvim.call('feedkeys', ['\x1b', "in"], true)
    // create window
    let res = await this.nvim.call('coc#util#create_float_win', [this.winid, this._bufnr, config])
    if (!res) return
    this.onCursorMoved.clear()
    let winid = this.winid = res[0] as number
    let bufnr = this._bufnr = res[1]
    if (token.isCancellationRequested) return
    nvim.pauseNotification()
    if (!this.env.isVim) {
      nvim.command(`noa call win_gotoid(${winid})`, true)
      this.floatBuffer.setLines(bufnr)
      nvim.command(`noa normal! gg0`, true)
      nvim.command('noa wincmd p', true)
    } else {
      // no need to change cursor position
      this.floatBuffer.setLines(bufnr, winid)
      nvim.call('win_execute', [winid, `noa normal! gg0`], true)
      nvim.command('redraw', true)
    }
    this.emit('show', winid, bufnr)
    let [, err] = await nvim.resumeNotification()
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    if (err) {
      logger.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
      return
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
    let { winid } = this
    this.cancel()
    if (winid) {
      // TODO: sometimes this won't work at all
      this.nvim.call('coc#util#close_win', [winid], true)
      this.winid = 0
      if (this.env.isVim) this.nvim.command('redraw', true)
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
    return await this.nvim.call('coc#util#valid_float_win', [this.winid]) != 0
  }

  private getMaxWindowHeight(docs: Documentation[]): number {
    let maxWidth = Math.min(this.maxWidth || 80, 80, this.env.columns)
    let w = maxWidth - 2
    let h = 0
    for (let doc of docs) {
      let lines = doc.content.split(/\r?\n/)
      for (let s of lines) {
        if (s.length == 0) {
          h = h + 1
        } else {
          h = h + Math.ceil(byteLength(s.replace(/\t/g, '  ')) / w)
        }
      }
    }
    return Math.min(this.maxHeight, h)
  }
}
