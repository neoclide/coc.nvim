import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { Documentation, Env } from '../types'
import { disposeAll, wait } from '../util'
import FloatBuffer from './floatBuffer'
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
}

// factory class for floating window
export default class FloatFactory implements Disposable {
  public static creating = false
  private buffer: Buffer
  private window: Window
  private _creating = false
  private closeTs = 0
  private insertTs = 0
  private readonly _onWindowCreate = new Emitter<Window>()
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  public readonly onWindowCreate: Event<Window> = this._onWindowCreate.event
  constructor(private nvim: Neovim,
    private env: Env,
    private srcId: number,
    private relative: 'cursor' | 'win' | 'editor' = 'cursor') {

    events.on('InsertEnter', async () => {
      this.insertTs = Date.now()
      this.close()
    }, null, this.disposables)
    events.on('CursorMoved', async bufnr => {
      if (this.buffer && bufnr == this.buffer.id) return
      if (this.creating) return
      this.close()
    }, null, this.disposables)

    this.nvim.createNewBuffer(false, true).then(buf => {
      this.buffer = buf
      buf.setOption('buftype', 'nofile', true)
      buf.setOption('bufhidden', 'hide', true)
      this.floatBuffer = new FloatBuffer(buf, nvim, srcId)
    })
  }

  public get creating(): boolean {
    return this._creating
  }

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public async getBoundings(docs: Documentation[]): Promise<WindowConfig> {
    let { nvim } = this
    let { columns, lines } = this
    let alignTop = false
    let offsetX = 0
    await this.floatBuffer.setDocuments(docs, 60)
    let { height, width } = this.floatBuffer
    let [row, col] = await nvim.call('coc#util#win_position') as [number, number]
    if (lines - row < height && row > height) {
      alignTop = true
    }
    if (col + width > columns) {
      offsetX = col + width - columns
    }
    return {
      height: alignTop ? height : Math.min(height, (lines - row)),
      width: Math.min(columns, width),
      row: alignTop ? - height : 1,
      col: offsetX == 0 ? 0 : - offsetX
    }
  }

  public async create(docs: Documentation[]): Promise<Window | undefined> {
    if (!this.env.floating || docs.length == 0) return
    let now = Date.now()
    this._creating = true
    FloatFactory.creating = true
    this.closeWindow()
    let { nvim } = this
    let config = await this.getBoundings(docs)
    try {
      let window = this.window = await this.nvim.openFloatWindow(this.buffer, false, config.width, config.height, {
        col: config.col,
        row: config.row,
        relative: this.relative
      })
      this._onWindowCreate.fire(window)
      nvim.pauseNotification()
      window.setVar('popup', 1, true)
      window.setCursor([1, 1], true)
      window.setOption('list', false, true)
      window.setOption('wrap', false, true)
      window.setOption('previewwindow', true, true)
      window.setOption('number', false, true)
      window.setOption('cursorline', false, true)
      window.setOption('cursorcolumn', false, true)
      window.setOption('signcolumn', 'no', true)
      window.setOption('conceallevel', 2, true)
      window.setOption('relativenumber', false, true)
      window.setOption('winhl', `Normal:CocFloating,NormalNC:CocFloating`, true)
      nvim.call('win_gotoid', [window.id], true)
      this.floatBuffer.setLines()
      nvim.command('wincmd p', true)
      await nvim.resumeNotification()
      if (this.closeTs > now || this.insertTs > now) {
        this.closeWindow()
        this._creating = false
        FloatFactory.creating = false
        return
      }
      await wait(10)
    } catch (e) {
      // tslint:disable-next-line: no-console
      console.error(`error on create floating window:` + e.message)
      logger.error(e)
    } finally {
      FloatFactory.creating = false
      this._creating = false
    }
  }

  /**
   * Close float window
   */
  public close(): void {
    if (!this.env.floating) return
    this.closeTs = Date.now()
    this.closeWindow()
  }

  private closeWindow(): void {
    let { window } = this
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
      })
    }, 100)
  }

  public dispose(): void {
    this._onWindowCreate.dispose()
    disposeAll(this.disposables)
  }
}
