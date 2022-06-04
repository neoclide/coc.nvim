'use strict'
import { Neovim } from '@chemzqm/neovim'
import { parseDocuments } from '../markdown'
import { Documentation, FloatConfig } from '../types'
const logger = require('../util/logger')('completion-floating')

export interface FloatingConfig extends FloatConfig {
  excludeImages: boolean
}

export default class Floating {
  constructor(private nvim: Neovim) {
  }

  public show(docs: Documentation[], config: FloatingConfig): void {
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
      highlight: config.highlight ?? 'CocFloating',
      maxWidth: config.maxWidth || 80,
      rounded: config.rounded ? 1 : 0,
      focusable: config.focusable === true ? 1 : 0
    }
    if (config.shadow) opts.shadow = 1
    if (config.border) opts.border = [1, 1, 1, 1]
    if (config.borderhighlight) opts.borderhighlight = config.borderhighlight
    if (typeof config.winblend === 'number') opts.winblend = config.winblend
    nvim.call('coc#dialog#create_pum_float', [lines, opts], true)
    nvim.redrawVim()
  }

  public close(): void {
    this.nvim.call('coc#pum#close_detail', [], true)
  }
}
