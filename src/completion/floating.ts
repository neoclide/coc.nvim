import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { CancellationToken } from 'vscode-jsonrpc'
import { Chars } from '../model/chars'
import FloatBuffer from '../model/floatBuffer'
import { Documentation, PumBounding } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('floating')

interface Bounding {
  row: number
  col: number
  width: number
  height: number
}

export interface FloatingConfig {
  srcId: number
  maxPreviewWidth: number
  chars: Chars
}

export default class Floating {
  private window: Window
  private buffer: Buffer
  private bounding: PumBounding
  private floatBuffer: FloatBuffer
  private config: FloatingConfig

  constructor(private nvim: Neovim) {
    let configuration = workspace.getConfiguration('suggest')
    this.config = {
      srcId: workspace.createNameSpace('coc-pum-float'),
      chars: new Chars(configuration.get<string>('previewIsKeyword', '@,48-57,_192-255')),
      maxPreviewWidth: configuration.get<number>('maxPreviewWidth', 50)
    }
  }

  public async show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    let { nvim } = this
    this.bounding = bounding
    let curr = await nvim.call('win_getid')
    await this.checkBuffer()
    let rect = await this.calculateBounding(docs)
    if (this.window) {
      let valid = await this.window.valid
      if (!valid) this.window = null
    }
    if (token.isCancellationRequested) return
    if (!this.window) {
      try {
        let config = Object.assign({
          relative: 'editor',
          focusable: true
        }, rect)
        let win = this.window = await nvim.openFloatWindow(this.buffer, false, config)
        if (token.isCancellationRequested) {
          this.window = null
          await win.close()
          return
        }
        nvim.pauseNotification()
        nvim.command(`noa call win_gotoid(${win.id})`, true)
        nvim.command(`let w:float = 1`, true)
        nvim.command(`let w:popup = 1`, true)
        nvim.command(`setl nonumber norelativenumber nocursorline nocursorcolumn`, true)
        nvim.command(`setl nospell nolist nowrap foldcolumn=0`, true)
        nvim.command(`setl signcolumn=no conceallevel=2 listchars=eol:\\ `, true)
        nvim.command(`setl winhl=Normal:CocFloating,NormalNC:CocFloating`, true)
        nvim.command(`silent doautocmd User CocOpenFloat`, true)
        nvim.call('cursor', [1, 1], true)
        this.floatBuffer.setLines()
        nvim.command(`noa call win_gotoid(${curr})`, true)
        await nvim.resumeNotification()
      } catch (e) {
        logger.error(`Create preview error:`, e.stack)
      }
    } else {
      nvim.pauseNotification()
      let config = Object.assign({
        relative: 'editor'
      }, rect)
      this.window.setConfig(config, true)
      nvim.command(`noa call win_gotoid(${this.window.id})`, true)
      nvim.call('cursor', [1, 1], true)
      this.floatBuffer.setLines()
      nvim.command(`noa call win_gotoid(${curr})`, true)
      await nvim.resumeNotification()
    }
  }

  private async calculateBounding(docs: Documentation[]): Promise<Bounding> {
    // drawn lines
    let { bounding, config, floatBuffer } = this
    let { columns, lines } = workspace.env
    let { maxPreviewWidth } = config
    let pumWidth = bounding.width + (bounding.scrollbar ? 1 : 0)
    let showRight = true
    let delta = columns - bounding.col - pumWidth
    if (delta < maxPreviewWidth && bounding.col > maxPreviewWidth) {
      // show left
      showRight = false
    }
    let maxWidth = !showRight || delta > maxPreviewWidth ? maxPreviewWidth : delta
    await floatBuffer.setDocuments(docs, maxWidth)
    let maxHeight = lines - bounding.row - workspace.env.cmdheight - 1
    return {
      col: showRight ? bounding.col + pumWidth : bounding.col - floatBuffer.width,
      row: bounding.row,
      height: Math.min(maxHeight, floatBuffer.height),
      width: floatBuffer.width
    }
  }

  private async checkBuffer(): Promise<void> {
    let { buffer, nvim } = this
    if (buffer) {
      let valid = await buffer.valid
      if (valid) return
    }
    buffer = this.buffer = await this.nvim.createNewBuffer(false, true)
    await buffer.setOption('buftype', 'nofile')
    await buffer.setOption('bufhidden', 'hide')
    this.floatBuffer = new FloatBuffer(buffer, nvim)
  }

  public close(): void {
    let { window } = this
    if (!window) return
    this.window = null
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
}
