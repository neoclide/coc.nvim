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

export default class FloatingWindow {
  private window: Window
  private bounding: PumBounding
  private floatBuffer: FloatBuffer

  constructor(private nvim: Neovim,
    private buffer: Buffer,
    private config: FloatingConfig) {
    this.floatBuffer = new FloatBuffer(buffer, nvim, config.srcId)
  }

  public async show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    this.bounding = bounding
    let { nvim } = this
    let rect = await this.calculateBounding(docs)
    if (this.window) {
      let valid = await this.window.valid
      if (!valid) this.window = null
    }
    if (token.isCancellationRequested) return
    if (!this.window) {
      try {
        let win = this.window = await nvim.openFloatWindow(this.buffer, false, rect.width, rect.height, {
          col: rect.col,
          row: rect.row,
          relative: 'editor',
          focusable: true
        })
        nvim.pauseNotification()
        win.setVar('popup', 1, true)
        win.setOption('list', false, true)
        win.setOption('number', false, true)
        win.setOption('cursorline', false, true)
        win.setOption('cursorcolumn', false, true)
        win.setOption('signcolumn', 'no', true)
        win.setOption('conceallevel', 2, true)
        win.setOption('relativenumber', false, true)
        win.setOption('winhl', 'Normal:CocPumFloating,NormalNC:CocPumFloating', true)
        this.showBuffer()
        await nvim.resumeNotification()
      } catch (e) {
        logger.error(`Create preview error:`, e.stack)
      }
    } else {
      nvim.pauseNotification()
      this.window.configFloat(rect.width, rect.height, {
        col: rect.col,
        row: rect.row,
        relative: 'editor',
        focusable: true
      }, true)
      this.showBuffer()
      await nvim.resumeNotification()
    }
    if (token.isCancellationRequested) {
      nvim.call('coc#util#close_win', [this.window.id], true)
    }
  }

  private showBuffer(): void {
    let { window, nvim } = this
    nvim.call('win_gotoid', [this.window.id], true)
    window.notify('nvim_win_set_cursor', [window, [1, 1]])
    this.floatBuffer.setLines()
    nvim.command('wincmd p', true)
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
}
