import { CancellationToken } from 'vscode-jsonrpc'
import FloatBuffer from '../model/floatBuffer'
import { Documentation, PumBounding } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('floating')

interface Bounding {
  row: number
  col: number
  width: number
  height: number
  relative: string
}

export interface FloatingConfig {
  srcId: number
  maxPreviewWidth: number
  enable: boolean
}

export default class Floating {
  private winid = 0
  private bufnr = 0
  private floatBuffer: FloatBuffer
  private config: FloatingConfig

  constructor() {
    this.floatBuffer = new FloatBuffer(workspace.nvim)
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

  public async show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    if (!this.config.enable) return
    await this.showDocumentationFloating(docs, bounding, token)
  }

  private async showDocumentationFloating(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    let { nvim } = workspace
    let config = this.calculateBounding(docs, bounding)
    if (!config || token.isCancellationRequested) return
    await this.floatBuffer.setDocuments(docs, config.width)
    if (token.isCancellationRequested) return
    nvim.pauseNotification()
    nvim.call('coc#util#pumvisible', [], true)
    nvim.call('coc#float#create_float_win', [this.winid, this.bufnr, Object.assign({ autohide: true }, config)], true)
    let res = await nvim.resumeNotification()
    if (Array.isArray(res[1])) return
    let winid = this.winid = res[0][1][0]
    let bufnr = this.bufnr = res[0][1][1]
    if (token.isCancellationRequested) {
      this.close()
      return
    }
    nvim.pauseNotification()
    nvim.call('coc#util#pumvisible', [], true)
    if (workspace.isNvim) {
      nvim.call('coc#util#win_gotoid', [winid], true)
      this.floatBuffer.setLines(bufnr)
      nvim.command('noa normal! gg0', true)
      nvim.call('coc#float#nvim_scrollbar', [winid], true)
      nvim.command('noa wincmd p', true)
    } else {
      this.floatBuffer.setLines(bufnr, winid)
      nvim.call('win_execute', [winid, `noa normal! gg0`], true)
      nvim.command('redraw', true)
    }
    await nvim.resumeNotification()
  }

  public close(): void {
    if (!this.winid) return
    let { winid } = this
    this.winid = null
    workspace.nvim.call('coc#float#close', [winid], true)
    if (workspace.isVim) workspace.nvim.command('redraw', true)
  }

  private calculateBounding(docs: Documentation[], bounding: PumBounding): Bounding {
    let { config } = this
    let { columns, lines } = workspace.env
    let { maxPreviewWidth } = config
    let pumWidth = bounding.width + (bounding.scrollbar ? 1 : 0)
    let showRight = true
    let paddingRight = columns - bounding.col - pumWidth
    if (bounding.col > paddingRight) showRight = false
    let maxWidth = showRight ? paddingRight - 1 : bounding.col - 1
    maxWidth = Math.min(maxPreviewWidth, maxWidth)
    let maxHeight = lines - bounding.row - 2
    if (maxHeight <= 0) {
      logger.error(`Invalid count for &lines: ${lines} - ${bounding.row}`)
      return null
    }
    let { width, height } = FloatBuffer.getDimension(docs, maxWidth, maxHeight)
    if (width == 0 || height == 0) return null
    return {
      col: showRight ? bounding.col + pumWidth : bounding.col - width - 1,
      row: bounding.row,
      height,
      width,
      relative: 'editor'
    }
  }
}
