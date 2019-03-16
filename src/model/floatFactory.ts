import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { Documentation, Env } from '../types'
import { disposeAll, wait } from '../util'
import FloatBuffer from './floatBuffer'
import snippetsManager from '../snippets/manager'
import uuid = require('uuid/v1')
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
}

const creatingSet: Set<string> = new Set()

// factory class for floating window
export default class FloatFactory implements Disposable {
  private buffer: Buffer
  private window: Window
  private closeTs = 0
  private insertTs = 0
  private readonly _onWindowCreate = new Emitter<Window>()
  private disposables: Disposable[] = []
  private floatBuffer: FloatBuffer
  public readonly onWindowCreate: Event<Window> = this._onWindowCreate.event
  constructor(private nvim: Neovim,
    private env: Env,
    private srcId: number,
    private forceTop = false) {
    if (!env.floating) return

    events.on('InsertEnter', async () => {
      this.insertTs = Date.now()
      this.close()
    }, null, this.disposables)
    events.on('CursorMoved', async bufnr => {
      if (this.buffer && bufnr == this.buffer.id) return
      if (FloatFactory.creating) return
      this.close()
    }, null, this.disposables)
    events.on('InsertLeave', async () => {
      this.close()
    }, null, this.disposables)
  }

  private async createBuffer(): Promise<void> {
    if (this.buffer) return
    let buf = await this.nvim.createNewBuffer(false, true)
    this.buffer = buf
    await buf.setOption('buftype', 'nofile')
    await buf.setOption('bufhidden', 'hide')
    this.floatBuffer = new FloatBuffer(buf, this.nvim, this.srcId)
  }

  private get columns(): number {
    return this.env.columns
  }

  private get lines(): number {
    return this.env.lines - this.env.cmdheight - 1
  }

  public async getBoundings(docs: Documentation[]): Promise<WindowConfig> {
    let { nvim, forceTop } = this
    let { columns, lines } = this
    let alignTop = false
    let offsetX = 0
    let [row, col] = await nvim.call('coc#util#win_position') as [number, number]
    if (forceTop && row == 0) return
    await this.floatBuffer.setDocuments(docs, 60)
    let { height, width } = this.floatBuffer
    if (forceTop || (lines - row < height && row > height)) {
      alignTop = true
    }
    if (col + width > columns) {
      offsetX = col + width - columns
    }
    return {
      height: alignTop ? Math.min(row, height) : Math.min(height, (lines - row)),
      width: Math.min(columns, width),
      row: alignTop ? - height : 1,
      col: offsetX == 0 ? 0 : - offsetX
    }
  }

  public async create(docs: Documentation[]): Promise<Window | undefined> {
    if (!this.env.floating || docs.length == 0) return
    let id = uuid()
    creatingSet.add(id)
    try {
      if (!this.buffer) await this.createBuffer()
      let mode = await this.nvim.call('mode')
      if (['i', 'n', 'ic'].indexOf(mode) !== -1 ||
        (mode == 's' && snippetsManager.session && this.forceTop)) {
        let { nvim, forceTop } = this
        if (mode == 's') {
          await nvim.call('feedkeys', ['\x1b', 'in'])
        }
        let config = await this.getBoundings(docs)
        if (config) {
          this.close()
          let now = Date.now()
          let window = this.window = await this.nvim.openFloatWindow(this.buffer, false, config.width, config.height, {
            col: config.col,
            row: config.row,
            relative: 'cursor'
          })
          this._onWindowCreate.fire(window)
          nvim.pauseNotification()
          window.setVar('float', 1, true)
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
          if (forceTop) nvim.command('normal! G', true)
          nvim.command('wincmd p', true)
          await nvim.resumeNotification()
          if (this.closeTs > now || this.insertTs > now) {
            logger.debug('close')
            this.closeWindow(window)
          } else if (mode == 's') {
            await snippetsManager.selectCurrentPlaceholder(false)
          }
          await wait(30)
        }
      }
    } catch (e) {
      // tslint:disable-next-line: no-console
      console.error(`error on create floating window:` + e.message)
      logger.error(e)
    }
    creatingSet.delete(id)
  }

  /**
   * Close float window
   */
  public close(): void {
    if (!this.env.floating) return
    this.closeTs = Date.now()
    this.closeWindow()
  }

  private closeWindow(window?: Window): void {
    window = window || this.window
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
    }, 200)
  }

  public dispose(): void {
    this._onWindowCreate.dispose()
    disposeAll(this.disposables)
  }

  public static get creating(): boolean {
    return creatingSet.size > 0
  }
}
