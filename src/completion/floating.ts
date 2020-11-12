import { Neovim } from '@chemzqm/neovim'
import { CancellationToken } from 'vscode-jsonrpc'
import { parseDocuments } from '../markdown'
import { Documentation, PumBounding } from '../types'
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
}

export default class Floating {
  private winid = 0
  private bufnr = 0

  constructor(
    private nvim: Neovim,
    private isVim: boolean) {
  }

  public async show(docs: Documentation[], bounding: PumBounding, config: FloatingConfig, token: CancellationToken): Promise<void> {
    let { nvim } = this
    docs = docs.filter(o => o.content.trim().length > 0)
    let { lines, codes, highlights } = parseDocuments(docs)
    if (lines.length == 0) {
      this.close()
      return
    }
    let res = await nvim.call('coc#float#create_pum_float', [this.winid, this.bufnr, lines, {
      codes,
      highlights,
      maxWidth: config.maxPreviewWidth,
      pumbounding: bounding,
    }])
    if (this.isVim) nvim.command('redraw', true)
    if (!res || res.length == 0) return
    this.winid = res[0]
    this.bufnr = res[1]
    if (token.isCancellationRequested) {
      this.close()
      return
    }
  }

  public close(): void {
    let { winid, nvim } = this
    this.winid = 0
    if (!winid) return
    nvim.call('coc#float#close', [winid], true)
    if (this.isVim) nvim.command('redraw', true)
  }
}
