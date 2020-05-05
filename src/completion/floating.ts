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
}

export interface FloatingConfig {
  srcId: number
  maxPreviewWidth: number
  enable: boolean
}

export default class Floating {
  private winid: number
  private floatBuffer: FloatBuffer
  private config: FloatingConfig

  constructor() {
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
    if (enableFloat) {
      workspace.registerAutocmd({
        event: 'CompleteDone',
        callback: async () => {
          if (!this.winid) return
          let { winid } = this
          this.winid = null
          await workspace.nvim.call('coc#util#close_win', [winid])
        }
      })
    }
  }

  public async show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    if (!this.config.enable) return
    await this.showDocumentationFloating(docs, bounding, token)
  }

  private async showDocumentationFloating(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void> {
    let { nvim } = workspace
    this.floatBuffer = await this.createFloatBuffer()
    let rect = await this.calculateBounding(docs, bounding)
    if (token.isCancellationRequested) return
    let config = Object.assign({ relative: 'editor' }, rect)
    if (!config || token.isCancellationRequested) return
    let winid = this.winid = await nvim.call('coc#util#create_float_win', [this.winid, this.bufnr, config])
    if (!winid || token.isCancellationRequested) return
    nvim.pauseNotification()
    nvim.setVar('coc_popup_id', winid, true)
    if (workspace.isNvim) {
      nvim.command(`noa call win_gotoid(${winid})`, true)
      this.floatBuffer.setLines()
      nvim.command('noa normal! gg0', true)
      nvim.command('noa wincmd p', true)
    } else {
      let filetype = docs[0].filetype
      this.floatBuffer.setLines(winid)
      nvim.call('win_execute', [winid, `setfiletype ${filetype}`], true)
      nvim.call('win_execute', [winid, `noa normal! gg0`], true)
      nvim.command('redraw', true)
    }
    let [, err] = await nvim.resumeNotification()
    // tslint:disable-next-line: no-console
    if (err) console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
  }

  public close(): void {
    if (!this.winid) return
    let { winid } = this
    this.winid = null
    workspace.nvim.call('coc#util#close_win', [winid], true)
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
      col: showRight ? bounding.col + pumWidth : bounding.col - floatBuffer.width - 1,
      row: bounding.row,
      height: Math.min(maxHeight, floatBuffer.getHeight(docs, maxWidth)),
      width: floatBuffer.width
    }
  }

  private async createFloatBuffer(): Promise<FloatBuffer> {
    let { nvim } = workspace
    let arr = await nvim.call('coc#util#create_float_buf', [this.bufnr])
    return arr[1] ? new FloatBuffer(nvim, nvim.createBuffer(arr[1])) : null
  }

  private get bufnr(): number {
    let { floatBuffer } = this
    return floatBuffer ? floatBuffer.buffer.id : 0
  }
}
