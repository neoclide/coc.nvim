'use strict'
import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import { parseDocuments } from '../markdown'
import sources from '../sources'
import { Documentation, ExtendedCompleteItem, FloatConfig } from '../types'
import workspace from '../workspace'
const logger = require('../util/logger')('completion-floating')

export interface FloatingConfig extends FloatConfig {
  excludeImages: boolean
}

export default class Floating {
  private tokenSource: CancellationTokenSource
  private excludeImages = true
  constructor(private nvim: Neovim) {
    this.excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument')
  }

  public async resolveItem(item: ExtendedCompleteItem, floatConfig: Readonly<FloatConfig>, filetype: string): Promise<void> {
    let source = this.tokenSource = new CancellationTokenSource()
    let { token } = source
    await this.doCompleteResolve(item, source)
    if (token.isCancellationRequested) return
    let docs = item.documentation ?? []
    if (docs.length === 0 && typeof item.info === 'string') {
      let { info } = item
      let isText = /^[\w-\s.,\t]+$/.test(info)
      docs = [{ filetype: isText ? 'txt' : filetype, content: info }]
    }
    this.show(docs, Object.assign({}, floatConfig, { excludeImages: this.excludeImages }))
  }

  public show(docs: Documentation[], config: FloatingConfig): void {
    docs = docs.filter(o => o.content.trim().length > 0)
    if (docs.length === 0) {
      this.close()
    } else {
      let { lines, codes, highlights } = parseDocuments(docs, { excludeImages: config.excludeImages })
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

  public doCompleteResolve(item: ExtendedCompleteItem, tokenSource: CancellationTokenSource): Promise<void> {
    let source = sources.getSource(item.source)
    return new Promise<void>(resolve => {
      if (source && typeof source.onCompleteResolve === 'function') {
        let timer = setTimeout(() => {
          if (!tokenSource.token.isCancellationRequested) {
            tokenSource.cancel()
            this.close()
          }
          logger.warn(`Resolve timeout after 500ms: ${source.name}`)
          resolve()
        }, 500)
        Promise.resolve(source.onCompleteResolve(item, tokenSource.token)).then(() => {
          clearTimeout(timer)
          resolve()
        }, e => {
          logger.error(`Error on complete resolve: ${e.message}`, e)
          clearTimeout(timer)
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = undefined
    }
  }

  public close(): void {
    this.nvim.call('coc#pum#close_detail', [], true)
  }
}
