'use strict'
import { createLogger } from '../logger'
import { parseDocuments } from '../markdown'
import { Documentation, FloatConfig } from '../types'
import { getConditionValue } from '../util'
import { CancellationError, isCancellationError } from '../util/errors'
import * as Is from '../util/is'
import { CancellationToken, CancellationTokenSource } from '../util/protocol'
import workspace from '../workspace'
import { CompleteItem, CompleteOption, ISource } from './types'
import { getDocumentaions } from './util'
const logger = createLogger('completion-floating')
const RESOLVE_TIMEOUT = getConditionValue(500, 50)

export default class Floating {
  private resolveTokenSource: CancellationTokenSource | undefined
  constructor(private config: { floatConfig: FloatConfig }) {
  }

  public async resolveItem(source: ISource, item: CompleteItem, opt: CompleteOption, showDocs: boolean, detailRendered = false): Promise<void> {
    this.cancel()
    if (Is.func(source.onCompleteResolve)) {
      try {
        await this.requestWithToken(token => {
          return Promise.resolve(source.onCompleteResolve(item, opt, token))
        })
      } catch (e) {
        if (isCancellationError(e)) return
        logger.error(`Error on resolve complete item from ${source.name}:`, item, e)
        return
      }
    }
    if (showDocs) {
      this.show(getDocumentaions(item, opt.filetype, detailRendered))
    }
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

  public close(): void {
    workspace.nvim.call('coc#pum#close_detail', [], true)
    workspace.nvim.redrawVim()
  }

  private cancel(): void {
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = undefined
    }
  }

  private requestWithToken(fn: (token: CancellationToken) => Promise<void>): Promise<void> {
    let tokenSource = this.resolveTokenSource = new CancellationTokenSource()
    return new Promise<void>((resolve, reject) => {
      let called = false
      let onFinish = (err?: Error) => {
        if (called) return
        called = true
        disposable.dispose()
        clearTimeout(timer)
        if (this.resolveTokenSource === tokenSource) {
          this.resolveTokenSource = undefined
        }
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      }
      let timer = setTimeout(() => {
        tokenSource.cancel()
      }, RESOLVE_TIMEOUT)
      let disposable = tokenSource.token.onCancellationRequested(() => {
        onFinish(new CancellationError())
      })
      fn(tokenSource.token).then(() => {
        onFinish()
      }, e => {
        onFinish(e)
      })
    })
  }
}
