'use strict'
import { Neovim } from '@chemzqm/neovim'
import { parseDocuments } from '../markdown'
import { Documentation, FloatConfig } from '../types'
const logger = require('../util/logger')('floating')

export interface PumBounding {
  readonly height: number
  readonly width: number
  readonly row: number
  readonly col: number
  readonly scrollbar: boolean
}

export interface FloatingConfig extends FloatConfig {
  excludeImages: boolean
}

export default class Floating {
  constructor(
    private nvim: Neovim,
    private isVim: boolean) {
  }

  public show(docs: Documentation[], bounding: PumBounding, config: FloatingConfig): void {
    let { nvim } = this
    docs = docs.filter(o => o.content.trim().length > 0)
    let { lines, codes, highlights } = parseDocuments(docs, { excludeImages: config.excludeImages })
    if (lines.length == 0) {
      this.close()
      return
    }
    let opts: any = {
      codes,
      highlights,
      maxWidth: config.maxWidth || 80,
      pumbounding: bounding,
    }
    if (config.border) opts.border = [1, 1, 1, 1]
    if (config.highlight) opts.highlight = config.highlight
    if (config.borderhighlight) opts.borderhighlight = config.borderhighlight
    if (!this.isVim) {
      if (typeof config.winblend === 'number') opts.winblend = config.winblend
      opts.focusable = config.focusable === true ? 1 : 0
      if (config.shadow) opts.shadow = 1
    }
    nvim.call('coc#dialog#create_pum_float', [lines, opts], true)
    nvim.redrawVim()
  }

  public close(): void {
    this.nvim.call('coc#pum#close_detail', [], true)
  }
}
