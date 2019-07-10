import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import { CancellationToken } from 'vscode-jsonrpc'
import FloatBuffer from '../model/floatBuffer'
import createPopup, { Popup } from '../model/popup'
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
  enable: boolean
}

export default class Floating {
  private window: Window
  private floatBuffer: FloatBuffer
  private config: FloatingConfig
  private popup: Popup

  constructor(private nvim: Neovim) {
    let configuration = workspace.getConfiguration('suggest')
    let enableFloat = configuration.get<boolean>('floatEnable', true)
    let { env } = workspace
    if (enableFloat && !env.floating && !env.textprop) {
      enableFloat = false
    }
    this.config = {
      srcId: workspace.createNameSpace('coc-pum-float'),
      maxPreviewWidth: configuration.get<number>('maxPreviewWidth', 80),
      enable: enableFloat
    }
  }

  private get buffer(): Buffer {
    let { floatBuffer } = this
    return floatBuffer ? floatBuffer.buffer : null
  }

  private async showDocumentationFloating(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    let { nvim } = this
    await this.checkBuffer()
    let rect = await this.calculateBounding(docs, bounding)
    let config = Object.assign({ relative: 'editor', }, rect)
    if (this.window) {
      let valid = await this.window.valid
      if (!valid) this.window = null
    }
    if (token.isCancellationRequested) return
    if (!this.window) {
      try {
        let win = this.window = await nvim.openFloatWindow(this.buffer, false, config)
        if (token.isCancellationRequested) {
          this.close()
          return
        }
        nvim.pauseNotification()
        win.setVar('float', 1, true)
        win.setVar('popup', 1, true)
        nvim.command(`noa call win_gotoid(${win.id})`, true)
        nvim.command(`setl nospell nolist wrap linebreak foldcolumn=1`, true)
        nvim.command(`setl nonumber norelativenumber nocursorline nocursorcolumn`, true)
        nvim.command(`setl signcolumn=no conceallevel=2`, true)
        nvim.command(`setl winhl=Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating`, true)
        nvim.command(`silent doautocmd User CocOpenFloat`, true)
        this.floatBuffer.setLines()
        nvim.call('cursor', [1, 1], true)
        nvim.command(`noa wincmd p`, true)
        let [, err] = await nvim.resumeNotification()
        // tslint:disable-next-line: no-console
        if (err) console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
      } catch (e) {
        logger.error(`Create preview error:`, e.stack)
      }
    } else {
      nvim.pauseNotification()
      this.window.setConfig(config, true)
      nvim.command(`noa call win_gotoid(${this.window.id})`, true)
      nvim.call('cursor', [1, 1], true)
      this.floatBuffer.setLines()
      nvim.command(`noa wincmd p`, true)
      let [, err] = await nvim.resumeNotification()
      // tslint:disable-next-line: no-console
      if (err) console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
    }
  }

  private async showDocumentationVim(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    let { nvim } = this
    await this.checkBuffer()
    let rect = await this.calculateBounding(docs, bounding)
    if (token.isCancellationRequested) return this.close()
    nvim.pauseNotification()
    this.floatBuffer.setLines()
    this.popup.move({
      line: rect.row + 1,
      col: rect.col + 1,
      minwidth: rect.width,
      minheight: rect.height,
      maxwidth: rect.width,
      maxheight: rect.height
    })
    this.popup.show()
    nvim.command('redraw', true)
    let [, err] = await nvim.resumeNotification()
    // tslint:disable-next-line: no-console
    if (err) console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
  }

  public async show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    if (!this.config.enable) return
    if (workspace.env.floating) {
      await this.showDocumentationFloating(docs, bounding, token)
    } else {
      await this.showDocumentationVim(docs, bounding, token)
    }
  }

  private async calculateBounding(docs: Documentation[], bounding: PumBounding): Promise<Bounding> {
    // drawn lines
    let { config, floatBuffer } = this
    let { columns, lines } = workspace.env
    let { maxPreviewWidth } = config
    let pumWidth = bounding.width + (bounding.scrollbar ? 1 : 0)
    let showRight = true
    let paddingRight = columns - bounding.col - pumWidth
    if (bounding.col > paddingRight) showRight = false
    let maxWidth = showRight ? paddingRight : bounding.col - 1
    maxWidth = Math.min(maxPreviewWidth, maxWidth)
    await floatBuffer.setDocuments(docs, maxWidth)
    let maxHeight = lines - bounding.row - workspace.env.cmdheight - 1
    return {
      col: showRight ? bounding.col + pumWidth : bounding.col - floatBuffer.width,
      row: bounding.row,
      height: Math.min(maxHeight, floatBuffer.getHeight(docs, maxWidth)),
      width: floatBuffer.width
    }
  }

  private async checkBuffer(): Promise<void> {
    let { buffer, nvim, popup } = this
    if (workspace.env.textprop) {
      if (popup) {
        let visible = await popup.visible()
        if (!visible) {
          popup.dispose()
          popup = null
        }
      }
      if (!popup) {
        this.popup = await createPopup(nvim, [''], {
          padding: [0, 1, 0, 1],
          highlight: 'CocFloating',
          tab: -1,
        })
        let win = nvim.createWindow(this.popup.id)
        nvim.pauseNotification()
        win.setVar('float', 1, true)
        win.setVar('popup', 1, true)
        win.setOption('linebreak', true, true)
        win.setOption('showbreak', '', true)
        win.setOption('conceallevel', 2, true)
        await nvim.resumeNotification()
      }
      buffer = this.nvim.createBuffer(this.popup.bufferId)
      this.floatBuffer = new FloatBuffer(nvim, buffer, nvim.createWindow(this.popup.id))
    } else {
      if (buffer) {
        let valid = await buffer.valid
        if (valid) return
      }
      buffer = await this.nvim.createNewBuffer(false, true)
      await buffer.setOption('buftype', 'nofile')
      await buffer.setOption('bufhidden', 'hide')
      this.floatBuffer = new FloatBuffer(nvim, buffer)
    }
  }

  public close(): void {
    if (workspace.env.textprop) {
      if (this.popup) {
        this.popup.dispose()
      }
      return
    }
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
          window = null
          clearInterval(interval)
        }
      }, _e => {
        clearInterval(interval)
      })
    }, 200)
  }
}
