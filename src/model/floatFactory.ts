import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, Emitter, Event, CancellationToken } from 'vscode-languageserver-protocol'
import events from '../events'
import workspace from '../workspace'
import snippetsManager from '../snippets/manager'
import { Documentation, Env } from '../types'
import { disposeAll, wait } from '../util'
import FloatBuffer from './floatBuffer'
import uuid = require('uuid/v1')
import { equals } from '../util/object'
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
  relative: 'cursor' | 'win' | 'editor'
}

const creatingIds: Set<string> = new Set()

// factory class for floating window
export default class FloatFactory implements Disposable {
  private buffer: Buffer
  private targetBufnr: number
  private window: Window
  private readonly _onWindowCreate = new Emitter<Window>()
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  private tokenSource: CancellationTokenSource
  private promise: Promise<void> = Promise.resolve(undefined)
  private alignTop = false
  private _creating = false
  private moving = false
  private createTs = 0
  private cursor: [number, number] = [0, 0]
  public readonly onWindowCreate: Event<Window> = this._onWindowCreate.event
  constructor(private nvim: Neovim,
    private env: Env,
    private preferTop = false,
    private maxHeight = 999,
    private joinLines = true,
    private maxWidth?: number) {
    if (!env.floating) return
    events.on('BufEnter', bufnr => {
      if (this.buffer && bufnr == this.buffer.id) return
      if (bufnr == this.targetBufnr) return
      this.close()
    }, null, this.disposables)
    events.on('InsertLeave', bufnr => {
      if (this.buffer && bufnr == this.buffer.id) return
      if (this.moving) return
      this.close()
    }, null, this.disposables)
    events.on('MenuPopupChanged', async (ev, cursorline) => {
      if (cursorline < ev.row && !this.alignTop) {
        this.close()
      } else if (cursorline > ev.row && this.alignTop) {
        this.close()
      }
    }, null, this.disposables)
    events.on('CursorMovedI', this.onCursorMoved.bind(this, true), null, this.disposables)
    events.on('CursorMoved', this.onCursorMoved.bind(this, false), null, this.disposables)
  }

  private onCursorMoved(insert: boolean, bufnr: number, cursor: [number, number]): void {
    if (this.buffer && bufnr == this.buffer.id) return
    if (this.moving || (bufnr == this.targetBufnr && equals(cursor, this.cursor))) return
    if (insert) {
      if (!this.window) return
      let ts = Date.now()
      setTimeout(() => {
        if (this.createTs > ts) return
        this.close()
      }, 2000)
    } else {
      this.close()
    }
  }

  private async createBuffer(): Promise<Buffer> {
    let buf = await this.nvim.createNewBuffer(false, true)
    await buf.setOption('buftype', 'nofile')
    await buf.setOption('bufhidden', 'hide')
    return buf
  }

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public async getBoundings(docs: Documentation[]): Promise<WindowConfig> {
    let { nvim, preferTop } = this
    let { columns, lines } = this
    let alignTop = false
    let offsetX = 0
    let [row, col] = await nvim.call('coc#util#win_position') as [number, number]
    let maxWidth = this.maxWidth || Math.min(columns - 10, 80)
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
    let { width, highlightOffset } = this.floatBuffer
    if (col + width > columns) {
      offsetX = col + width - columns
    }
    offsetX = Math.max(offsetX, highlightOffset)
    offsetX = Math.min(col, offsetX)
    this.alignTop = alignTop
    return {
      height: alignTop ? Math.min(row, height) : Math.min(height, (lines - row)),
      width: Math.min(columns, width),
      row: alignTop ? - height : 1,
      col: offsetX == 0 ? 0 : - offsetX,
      relative: 'cursor'
    }
  }

  public async create(docs: Documentation[], allowSelection = false): Promise<void> {
    if (!this.env.floating) return
    this.createTs = Date.now()
    let id = uuid()
    creatingIds.add(id)
    this.targetBufnr = workspace.bufnr
    this.close()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    this._creating = true
    this.promise = this.promise.then(() => {
      if (token.isCancellationRequested) return
      return this._create(docs, allowSelection, token).then(() => {
        creatingIds.delete(id)
        this._creating = false
      }, e => {
        creatingIds.delete(id)
        logger.error('Error on create float window:', e)
        this._creating = false
      })
    })
    await this.promise
  }

  private async _create(docs: Documentation[], allowSelection = false, token: CancellationToken): Promise<Window | undefined> {
    if (docs.length == 0) return
    let [, line, col] = await this.nvim.call('getpos', ['.']) as number[]
    this.cursor = [line, col]
    let { floatBuffer } = this
    if (floatBuffer) {
      let valid = await floatBuffer.valid
      if (!valid) floatBuffer = null
    }
    if (!floatBuffer) {
      let buf = await this.createBuffer()
      let srcId = workspace.createNameSpace('coc-float')
      this.buffer = buf
      floatBuffer = this.floatBuffer = new FloatBuffer(buf, this.nvim, srcId, this.joinLines)
    }
    let config = await this.getBoundings(docs)
    if (!config || token.isCancellationRequested) return
    let mode = await this.nvim.call('mode') as string
    allowSelection = mode == 's' && allowSelection
    if (token.isCancellationRequested) return
    if (['i', 'n', 'ic'].indexOf(mode) !== -1 || allowSelection) {
      let { nvim, alignTop } = this
      // change to normal
      if (mode == 's') await nvim.call('feedkeys', ['\x1b', 'in'])
      // helps to fix undo issue, don't know why.
      if (mode.startsWith('i')) await nvim.eval('feedkeys("\\<C-g>u")')
      let window = await this.nvim.openFloatWindow(this.buffer, false, config)
      if (token.isCancellationRequested) {
        this.closeWindow(window)
        return
      }
      this.window = window
      this._onWindowCreate.fire(window)
      nvim.pauseNotification()
      window.setVar('float', 1, true)
      window.setCursor([1, 1], true)
      window.setOption('list', false, true)
      window.setOption('listchars', 'eol: ', true)
      window.setOption('wrap', false, true)
      window.setOption('previewwindow', true, true)
      window.setOption('number', false, true)
      window.setOption('cursorline', false, true)
      window.setOption('cursorcolumn', false, true)
      window.setOption('signcolumn', 'no', true)
      window.setOption('conceallevel', 2, true)
      window.setOption('relativenumber', false, true)
      window.setOption('winhl', `Normal:CocFloating,NormalNC:CocFloating`, true)
      nvim.command(`noa call win_gotoid(${window.id})`, true)
      floatBuffer.setLines()
      if (alignTop) nvim.command('normal! G', true)
      nvim.command('noa wincmd p', true)
      await nvim.resumeNotification()
      this.moving = true
      if (mode == 's') {
        await snippetsManager.selectCurrentPlaceholder(false)
      }
      await wait(30)
      this.moving = false
    }
  }

  /**
   * Close float window
   */
  public close(): void {
    if (!this.env.floating) return
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
    this.closeWindow(this.window)
  }

  private closeWindow(window: Window): void {
    if (!window) return
    this.nvim.call('coc#util#close_win', window.id, true)
    this.window = null
    let count = 0
    let interval = setInterval(() => {
      count++
      if (count == 5) clearInterval(interval)
      window.valid.then(valid => {
        if (valid) {
          this.nvim.call('coc#util#close_win', window.id, true)
        } else {
          clearInterval(interval)
        }
      }, _e => {
        clearInterval(interval)
      })
    }, 200)
  }

  public dispose(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
    }
    this._onWindowCreate.dispose()
    disposeAll(this.disposables)
  }

  public get creating(): boolean {
    return this._creating
  }

  public static get isCreating(): boolean {
    return creatingIds.size > 0
  }

  public async activated(): Promise<boolean> {
    if (!this.window) return false
    let valid = await this.window.valid
    return valid
  }
}
