'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { parseDocuments } from '../markdown'
import sources from '../sources'
import { CompleteOption, Documentation, ExtendedCompleteItem, FloatConfig } from '../types'
import { isCancellationError } from '../util/errors'
import workspace from '../workspace'
const logger = require('../util/logger')('completion-floating')

export default class Floating {
  private excludeImages = true
  constructor(private nvim: Neovim, private config: { floatConfig: FloatConfig }) {
    this.excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument')
  }

  public async resolveItem(item: ExtendedCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    await this.doCompleteResolve(item, opt, token)
    if (token.isCancellationRequested) return
    let docs = item.documentation ?? []
    if (docs.length === 0 && typeof item.info === 'string') {
      docs = [{ filetype: 'txt', content: item.info }]
    }
    this.show(docs)
  }

  public show(docs: Documentation[]): void {
    let config = this.config.floatConfig
    docs = docs.filter(o => o.content.trim().length > 0)
    if (docs.length === 0) {
      this.close()
    } else {
      let { lines, codes, highlights } = parseDocuments(docs, { excludeImages: this.excludeImages })
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
      this.nvim.call('coc#dialog#create_pum_float', [lines, opts], true)
      this.nvim.redrawVim()
    }
  }

  public async doCompleteResolve(item: ExtendedCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    let source = sources.getSource(item.source)
    if (!source || typeof source.onCompleteResolve !== 'function') return
    try {
      await Promise.resolve(source.onCompleteResolve(item, opt, token))
    } catch (e) {
      if (!isCancellationError(e)) logger.error(`Error on complete resolve of "${source.name}":`, e)
    }
  }

  public close(): void {
    this.nvim.call('coc#pum#close_detail', [], true)
  }
}
