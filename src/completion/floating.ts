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
      maxPreviewWidth: configuration.get<number>('maxPreviewWidth', 80)
    }
  }

  private async showDocumentationFloating(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    let { nvim } = this
    this.bounding = bounding
    await this.checkBuffer()
    let rect = await this.calculateBounding(docs)
    if (this.window) {
      let valid = await this.window.valid
      if (!valid) this.window = null
    }
    if (token.isCancellationRequested) return
    if (!this.window) {
      try {
        let config = Object.assign({ relative: 'editor', }, rect)
        let win = this.window = await nvim.openFloatWindow(this.buffer, false, config)
        if (token.isCancellationRequested) {
          this.close()
          return
        }
        nvim.pauseNotification()
        win.setVar('float', 1, true)
        win.setVar('popup', 1, true)
        win.setOption('wrap', true, true)
        win.setOption('linebreak', true, true)
        win.setOption('foldcolumn', 1, true)
        win.setOption('list', false, true)
        win.setOption('spell', false, true)
        win.setOption('listchars', 'eol: ', true)
        win.setOption('number', false, true)
        win.setOption('cursorline', false, true)
        win.setOption('cursorcolumn', false, true)
        win.setOption('signcolumn', 'no', true)
        win.setOption('conceallevel', 2, true)
        win.setOption('relativenumber', false, true)
        win.setOption('winhl', 'Normal:CocFloating,NormalNC:CocFloating,FoldColumn:CocFloating', true)
        nvim.command(`noa call win_gotoid(${win.id})`, true)
        this.floatBuffer.setLines()
        nvim.command(`normal! gg0`, true)
        nvim.command(`noa wincmd p`, true)
        let [, err] = await nvim.resumeNotification()
        if (err) workspace.showMessage(`Error on ${err[0]}: ${err[1]} - ${err[2]}`, 'error')
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
      nvim.command(`normal! gg0`, true)
      this.floatBuffer.setLines()
      nvim.command(`noa wincmd p`, true)
      let [, err] = await nvim.resumeNotification()
      if (err) workspace.showMessage(`Error on ${err[0]}: ${err[1]} - ${err[2]}`, 'error')
    }
  }

  private async showDocumentationVim(docs: Documentation[]): Promise<void> {
    if (workspace.completeOpt.indexOf('preview') == -1) return
    let lines = []
    for (let i = 0; i < docs.length; i++) {
      let { content } = docs[i]
      lines.push(...content.split(/\r?\n/))
      if (i != docs.length - 1) {
        lines.push('---')
      }
    }
    await this.nvim.call('coc#util#preview_info', [lines, 'txt'])
  }

  public async show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    if (workspace.env.floating) {
      await this.showDocumentationFloating(docs, bounding, token)
    } else {
      await this.showDocumentationVim(docs)
    }
  }

  private async calculateBounding(docs: Documentation[]): Promise<Bounding> {
    // drawn lines
    let { bounding, config, floatBuffer } = this
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
    if (workspace.isVim) {
      this.nvim.command('pclose', true)
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
          clearInterval(interval)
        }
      }, _e => {
        clearInterval(interval)
      })
    }, 200)
  }
}
