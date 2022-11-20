'use strict'
import { createLogger } from '../logger'
import { parseDocuments } from '../markdown'
import sources from '../sources'
import { CompleteOption, Documentation, DurationCompleteItem, FloatConfig } from '../types'
import { isCancellationError } from '../util/errors'
import { CancellationToken } from '../util/protocol'
import workspace from '../workspace'
const logger = createLogger('completion-floating')

export default class Floating {
  constructor(private config: { floatConfig: FloatConfig }) {
  }

  public async resolveItem(item: DurationCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
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
      const markdownPreference = workspace.configurations.markdownPreference
      let { lines, codes, highlights } = parseDocuments(docs, markdownPreference)
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
      let { nvim } = workspace
      nvim.call('coc#dialog#create_pum_float', [lines, opts], true)
      nvim.redrawVim()
    }
  }

  public async doCompleteResolve(item: DurationCompleteItem, opt: CompleteOption, token: CancellationToken): Promise<void> {
    let source = sources.getSource(item.source)
    if (!source || typeof source.onCompleteResolve !== 'function') return
    try {
      await Promise.resolve(source.onCompleteResolve(item, opt, token))
    } catch (e) {
      if (!isCancellationError(e)) logger.error(`Error on complete resolve of "${source.name}":`, e)
    }
  }

  public close(): void {
    workspace.nvim.call('coc#pum#close_detail', [], true)
  }
}
