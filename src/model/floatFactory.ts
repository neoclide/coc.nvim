import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import snippetsManager from '../snippets/manager'
import { Documentation, Env } from '../types'
import { disposeAll } from '../util'
import { equals } from '../util/object'
import workspace from '../workspace'
import FloatBuffer from './floatBuffer'
import debounce from 'debounce'
import createPopup, { Popup } from './popup'
import { distinct } from '../util/array'
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
  relative: 'cursor' | 'win' | 'editor'
}

// factory class for floating window
export default class FloatFactory implements Disposable {
  private targetBufnr: number
  private window: Window
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  private tokenSource: CancellationTokenSource
  private alignTop = false
  private pumAlignTop = false
  private createTs = 0
  private cursor: [number, number] = [0, 0]
  private popup: Popup
  public shown = false
  constructor(private nvim: Neovim,
    private env: Env,
    private preferTop = false,
    private maxHeight = 999,
    private maxWidth?: number,
    private autoHide = true) {
    if (!workspace.floatSupported) return
    this.maxWidth = Math.min(maxWidth || 80, this.columns - 10)
    events.on('BufEnter', bufnr => {
      if (this.buffer && bufnr == this.buffer.id) return
      if (bufnr == this.targetBufnr) return
      this.close()
    }, null, this.disposables)
    events.on('InsertLeave', bufnr => {
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
    events.on('CursorMoved', debounce((bufnr, cursor) => {
      if (Date.now() - this.createTs < 100) return
      this.onCursorMoved(false, bufnr, cursor)
    }, 100), null, this.disposables)
    events.on('CursorMovedI', this.onCursorMoved.bind(this, true), null, this.disposables)
  }

  private onCursorMoved(insertMode: boolean, bufnr: number, cursor: [number, number]): void {
    if (!this.window || this.buffer && bufnr == this.buffer.id) return
    if (bufnr == this.targetBufnr && equals(cursor, this.cursor)) return
    if (this.autoHide) {
      this.close()
      return
    }
    if (!insertMode || bufnr != this.targetBufnr || (this.cursor && cursor[0] != this.cursor[0])) {
      this.close()
      return
    }
  }

  private async checkFloatBuffer(): Promise<void> {
    let { floatBuffer, nvim, window } = this
    if (this.env.textprop) {
      let valid = await this.activated()
      if (!valid) window = null
      if (!window) {
        this.popup = await createPopup(nvim, [''], {
          padding: [0, 1, 0, 1],
          highlight: 'CocFloating',
          tab: -1,
        })
        let win = this.window = nvim.createWindow(this.popup.id)
        nvim.pauseNotification()
        win.setVar('float', 1, true)
        win.setOption('linebreak', true, true)
        win.setOption('showbreak', '', true)
        win.setOption('conceallevel', 2, true)
        await nvim.resumeNotification()
      }
      let buffer = this.nvim.createBuffer(this.popup.bufferId)
      this.floatBuffer = new FloatBuffer(nvim, buffer, nvim.createWindow(this.popup.id))
    } else {
      if (floatBuffer) {
        let valid = await floatBuffer.valid
        if (valid) return
      }
      let buf = await this.nvim.createNewBuffer(false, true)
      await buf.setOption('buftype', 'nofile')
      await buf.setOption('bufhidden', 'hide')
      this.floatBuffer = new FloatBuffer(this.nvim, buf)
    }
  }

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public async getBoundings(docs: Documentation[], offsetX = 0): Promise<WindowConfig> {
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
    if (offsetX) {
      offsetX = Math.min(col - 1, offsetX)
      if (col - offsetX + width > columns) {
        offsetX = col - offsetX + width - columns
      }
    }
    this.alignTop = alignTop
    return {
      height: alignTop ? Math.max(1, Math.min(row, height)) : Math.max(1, Math.min(height, (lines - row))),
      width: Math.min(columns, width),
      row: alignTop ? - height : 1,
      col: offsetX == 0 ? 0 : - offsetX,
      relative: 'cursor'
    }
  }
  public async create(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<void> {
    if (!workspace.floatSupported) {
      logger.error('Floating window & textprop not supported!')
      return
    }
    let shown = await this.createPopup(docs, allowSelection, offsetX)
    if (!shown) this.close(false)
  }

  private async createPopup(docs: Documentation[], allowSelection = false, offsetX = 0): Promise<boolean> {
    if (this.tokenSource) {
      this.tokenSource.cancel()
    }
    if (docs.length == 0) return false
    this.createTs = Date.now()
    this.targetBufnr = workspace.bufnr
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    await this.checkFloatBuffer()
    let config = await this.getBoundings(docs, offsetX)
    let [mode, line, col, visible] = await this.nvim.eval('[mode(),line("."),col("."),pumvisible()]') as [string, number, number, number]
    this.cursor = [line, col]
    if (visible && this.alignTop == this.pumAlignTop) return false
    if (!config || token.isCancellationRequested) return false
    if (!this.checkMode(mode, allowSelection)) return false
    let { nvim, alignTop } = this
    if (mode == 's') await nvim.call('feedkeys', ['\x1b', 'in'])
    // helps to fix undo issue, don't know why.
    if (workspace.isNvim && mode.startsWith('i')) await nvim.eval('feedkeys("\\<C-g>u", "n")')
    let reuse = false
    if (workspace.isNvim) {
      reuse = this.window && await this.window.valid
      if (!reuse) this.window = await nvim.openFloatWindow(this.buffer, false, config)
    }
    if (token.isCancellationRequested) return false
    nvim.pauseNotification()
    if (workspace.isNvim) {
      if (!reuse) {
        nvim.command(`noa call win_gotoid(${this.window.id})`, true)
        this.window.setVar('float', 1, true)
        nvim.command(`setl nospell nolist wrap linebreak foldcolumn=1`, true)
        nvim.command(`setl nonumber norelativenumber nocursorline nocursorcolumn colorcolumn=`, true)
        nvim.command(`setl signcolumn=no conceallevel=2 concealcursor=n`, true)
        nvim.command(`setl winhl=Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating`, true)
        nvim.call('coc#util#do_autocmd', ['CocOpenFloat'], true)
      } else {
        this.window.setConfig(config, true)
        nvim.command(`noa call win_gotoid(${this.window.id})`, true)
      }
      this.floatBuffer.setLines()
      nvim.command(`normal! ${alignTop ? 'G' : 'gg'}0`, true)
      nvim.command('noa wincmd p', true)
    } else {
      let filetypes = distinct(docs.map(d => d.filetype))
      if (filetypes.length == 1) {
        this.popup.setFiletype(filetypes[0])
      }
      this.popup.move({
        line: cursorPostion(config.row),
        col: cursorPostion(config.col),
        minwidth: config.width - 2,
        minheight: config.height,
        maxwidth: config.width - 2,
        maxheight: config.height,
        firstline: alignTop ? -1 : 1
      })
      this.floatBuffer.setLines()
      nvim.command('redraw', true)
    }
    let [, err] = await nvim.resumeNotification()
    if (err) {
      workspace.showMessage(`Error on ${err[0]}: ${err[1]} - ${err[2]}`, 'error')
      return false
    }
    if (mode == 's') await snippetsManager.selectCurrentPlaceholder(false)
    return true
  }

  private checkMode(mode: string, allowSelection: boolean): boolean {
    if (mode == 's' && allowSelection) {
      return true
    }
    return ['i', 'n', 'ic'].indexOf(mode) != -1
  }

  /**
   * Close float window
   */
  public close(cancel = true): void {
    if (cancel && this.tokenSource) {
      if (this.tokenSource) {
        this.tokenSource.cancel()
        this.tokenSource = null
      }
    }
    let { window, popup } = this
    this.shown = false
    if (this.env.textprop) {
      if (popup) popup.dispose()
    } else if (window) {
      window.close(true, true)
    }
  }

  public dispose(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
    }
    disposeAll(this.disposables)
  }

  public get buffer(): Buffer {
    return this.floatBuffer ? this.floatBuffer.buffer : null
  }

  public async activated(): Promise<boolean> {
    if (this.env.textprop) {
      if (!this.popup) return false
      return await this.popup.visible()
    }
    if (!this.window) return false
    let valid = await this.window.valid
    return valid
  }
}

function cursorPostion(n: number): string {
  if (n == 0) return 'cursor'
  if (n < 0) return `cursor${n}`
  return `cursor+${n}`
}
