import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { Env } from '../types'
import { byteLength } from '../util/string'
import { Chars } from './chars'
import { Emitter, Event } from 'vscode-languageserver-protocol'
import { wait } from '../util'
const logger = require('../util/logger')('model-float')

export interface WindowConfig {
  width: number
  height: number
  col: number
  row: number
}

// factory class for floating window
export default class FloatFactory {
  private buffer: Buffer
  private window: Window
  private _creating = false
  private chars = new Chars('@,48-57,_192-255,<,>,$,#,-')
  private readonly _onWindowCreate = new Emitter<Window>()
  public readonly onWindowCreate: Event<Window> = this._onWindowCreate.event
  constructor(private nvim: Neovim,
    private env: Env,
    private name = '',
    private relative: 'cursor' | 'win' | 'editor' = 'cursor') {
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

  public async getBoundings(arr: string[]): Promise<WindowConfig> {
    let { nvim } = this
    let { columns, lines } = this
    let alignTop = false
    let offsetX = 0
    let height = arr.length
    let width = Math.max(...arr.map(l => byteLength(l)))
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

  public async create(lines: string[], filetype: string, hlGroup = 'CocFloating', config?: WindowConfig): Promise<Window | undefined> {
    if (!this.env.floating) return
    this._creating = true
    lines = lines.reduce((p, c) => {
      return p.concat(this.softSplit(c, 78))
    }, [] as string[])
    lines = lines.map(s => ' ' + s + ' ')
    if (!lines.length) lines = ['No result']
    let { nvim, buffer, window } = this
    if (!config) config = await this.getBoundings(lines)
    try {
      if (!buffer) {
        buffer = this.buffer = await this.nvim.createNewBuffer(false, true)
        await buffer.setOption('buftype', 'nofile')
        await buffer.setOption('bufhidden', 'hide')
      }
      nvim.pauseNotification()
      if (window) this.nvim.call('coc#util#close_win', [window.id], true)
      buffer.setLines(lines, { start: 0, end: -1, strictIndexing: false }, true)
      if (filetype) buffer.setOption('filetype', filetype, true)
      window = this.window = await this.nvim.openFloatWindow(this.buffer, false, config.width, config.height, {
        col: config.col,
        row: config.row,
        relative: this.relative
      })
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
      window.setOption('winhl', `Normal:${hlGroup},NormalNC:${hlGroup}`, true)
      await nvim.resumeNotification()
      await wait(30)
      logger.debug('created:', this.window.id)
    } catch (e) {
      // tslint:disable-next-line: no-console
      console.error(`error on create floating window:` + e.message)
    } finally {
      this._onWindowCreate.fire(this.window)
      this._creating = false
    }
  }

  public async close(): Promise<void> {
    if (!this.env.floating) return
    if (this._creating) {
      return new Promise<void>((resolve, reject) => {
        let disposable = this.onWindowCreate(() => {
          disposable.dispose()
          this.closeWindow().then(resolve, reject)
        })
      })
    }
    await this.closeWindow()
  }

  private softSplit(line: string, maxWidth: number): string[] {
    let res: string[] = []
    let { chars } = this
    let finished = false
    let start = 0
    if (byteLength(line) < maxWidth) return [line]
    do {
      let len = 0
      let lastNonKeyword = 0
      for (let i = start; i < line.length; i++) {
        let ch = line[i]
        let code = ch.charCodeAt(0)
        let iskeyword = code < 255 && chars.isKeywordCode(code)
        if (len >= maxWidth) {
          if (iskeyword && lastNonKeyword) {
            res.push(line.slice(start, lastNonKeyword + 1).replace(/\s+$/, ''))
            start = lastNonKeyword + 1
          } else {
            let end = len == maxWidth ? i : i - 1
            res.push(line.slice(start, end).replace(/\s+$/, ''))
            start = end
          }
          break
        }
        len = len + byteLength(ch)
        if (!iskeyword) lastNonKeyword = i
        if (i == line.length - 1) {
          let content = line.slice(start, i + 1).replace(/\s+$/, '')
          if (content.length) res.push(content)
          finished = true
        }
      }
    } while (!finished)
    return res
  }

  private async closeWindow(): Promise<void> {
    let { window } = this
    if (!window) return
    try {
      await this.nvim.call('coc#util#close_win', window.id)
      this.window = null
    } catch (e) {
      logger.error(`Error on close window:`, e)
    }
  }
}
