import { CancellationToken } from 'vscode-jsonrpc'
import { parseDocuments } from '../markdown'
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
  maxPreviewWidth: number
  enable: boolean
}

export default class Floating {
  private winid = 0
  private bufnr = 0
  private config: FloatingConfig

  constructor() {
    let configuration = workspace.getConfiguration('suggest')
    let enableFloat = configuration.get<boolean>('floatEnable', true)
    let { env } = workspace
    if (enableFloat && !env.floating && !env.textprop) {
      enableFloat = false
    }
    this.config = {
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
    docs = docs.filter(o => o.content.trim().length > 0)
    let { lines, codes, highlights } = parseDocuments(docs)
    let res = await nvim.call('coc#float#create_pum_float', [this.winid, this.bufnr, lines, {
      codes,
      highlights,
      maxWidth: this.config.maxPreviewWidth,
      pumbounding: bounding,
    }])
    if (!res || res.length == 0) return
    this.winid = res[0]
    this.bufnr = res[1]
    if (token.isCancellationRequested) {
      this.close()
      return
    }
  }

  public close(): void {
    let { winid } = this
    this.winid = 0
    if (!winid) return
    workspace.nvim.call('coc#float#close', [winid], true)
    if (workspace.isVim) workspace.nvim.command('redraw', true)
  }
}
