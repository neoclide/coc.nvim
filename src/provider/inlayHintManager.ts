'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlayHint, Position, Range } from 'vscode-languageserver-types'
import { createLogger } from '../logger'
import { comparePosition, positionInRange } from '../util/position'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, InlayHintsProvider } from './index'
import Manager from './manager'
const logger = createLogger('inlayHintManger')

export interface InlayHintWithProvider extends InlayHint {
  providerId: string
  resolved?: boolean
}

export default class InlayHintManger extends Manager<InlayHintsProvider> {

  public register(selector: DocumentSelector, provider: InlayHintsProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are asked in
   * parallel and the results are merged. A failing provider (rejected promise or exception) will
   * not cause a failure of the whole operation.
   */
  public async provideInlayHints(
    document: TextDocument,
    range: Range,
    token: CancellationToken
  ): Promise<InlayHintWithProvider[] | null> {
    let items = this.getProviders(document)
    let inlayHints: InlayHintWithProvider[] = []
    await Promise.all(items.map(item => {
      let { id, provider } = item
      return Promise.resolve(provider.provideInlayHints(document, range, token)).then(hints => {
        if (!Array.isArray(hints) || token.isCancellationRequested) return
        let noCheck = inlayHints.length == 0
        for (let hint of hints) {
          if (!isValidInlayHint(hint, range)) continue
          if (!noCheck && inlayHints.findIndex(o => sameHint(o, hint)) != -1) continue
          inlayHints.push({ providerId: id, ...hint })
        }
      })
    }))
    return inlayHints
  }

  public async resolveInlayHint(hint: InlayHintWithProvider, token: CancellationToken): Promise<InlayHintWithProvider> {
    let provider = this.getProviderById(hint.providerId)
    if (!provider || typeof provider.resolveInlayHint !== 'function' || hint.resolved === true) return hint
    let res = await Promise.resolve(provider.resolveInlayHint(hint, token))
    if (token.isCancellationRequested) return hint
    return Object.assign(hint, res, { resolved: true })
  }
}

export function sameHint(one: InlayHint, other: InlayHint): boolean {
  if (comparePosition(one.position, other.position) !== 0) return false
  return getLabel(one) === getLabel(other)
}

export function isInlayHint(obj: any): obj is InlayHint {
  if (!obj || !Position.is(obj.position) || obj.label == null) return false
  if (typeof obj.label !== 'string') return Array.isArray(obj.label) && obj.label.every(p => typeof p.value === 'string')
  return true
}

export function isValidInlayHint(hint: InlayHint, range: Range): boolean {
  if (hint.label.length === 0 || (Array.isArray(hint.label) && hint.label.every(part => part.value.length === 0))) {
    logger.warn('INVALID inlay hint, empty label', hint)
    return false
  }
  if (!isInlayHint(hint)) {
    logger.warn('INVALID inlay hint', hint)
    return false
  }
  if (range && positionInRange(hint.position, range) !== 0) {
    // console.log('INVALID inlay hint, position outside range', range, hint);
    return false
  }
  return true
}

export function getLabel(hint: InlayHint): string {
  if (typeof hint.label === 'string') return hint.label
  return hint.label.map(o => o.value).join('')
}
