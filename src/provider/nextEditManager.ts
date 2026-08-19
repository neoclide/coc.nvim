'use strict'
import { Position } from 'vscode-languageserver-types'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { toArray } from '../util/array'
import { shouldIgnore } from '../util/errors'
import { createLogger } from '../logger'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentSelector, NextEditContext, NextEditItem, NextEditList, NextEditProvider } from './index'
import Manager, { ProviderItem } from './manager'
const logger = createLogger('provider-next-edit')

function itemKey(item: NextEditItem): string {
  let { textDocument, range, newText } = item
  return JSON.stringify([textDocument.uri, textDocument.version, range, newText])
}

export default class NextEditManager extends Manager<NextEditProvider> {
  private owners = new WeakMap<object, NextEditProvider>()

  public register(selector: DocumentSelector, provider: NextEditProvider): Disposable {
    return this.addProvider({ id: crypto.randomUUID(), selector, provider })
  }

  public get isEmpty(): boolean {
    return this.providers.size === 0
  }

  public async provideNextEdits(
    document: TextDocument,
    position: Position,
    context: NextEditContext & { provider?: string },
    token: CancellationToken
  ): Promise<NextEditItem[]> {
    let providers: ProviderItem<NextEditProvider>[]
    if (context.provider) {
      let item = this.getProvideByExtension(document, context.provider)
      providers = item ? [item] : []
    } else {
      providers = this.getProviders(document)
    }
    if (providers.length === 0 || token.isCancellationRequested) return []
    let results = await Promise.all(providers.map(async item => {
      try {
        let result = await item.provider.provideNextEdits(document, position, {
          triggerKind: context.triggerKind
        }, token)
        return Array.isArray(result) ? result : toArray((result as NextEditList | null | undefined)?.items)
      } catch (err) {
        try {
          this.handleResults([{ status: 'rejected', reason: err }], 'provideNextEdits', [item], token)
        } catch (error) {
          // A cancellation surfaced by one provider must not fail the whole
          // request: other providers may still produce candidates.
          void error
        }
        return []
      }
    }))
    if (token.isCancellationRequested) return []
    let items: NextEditItem[] = []
    let seen = new Set<string>()
    for (let i = 0; i < results.length; i++) {
      for (let item of results[i]) {
        if (!item || typeof item !== 'object') continue
        let candidate = item as NextEditItem
        if (!candidate.textDocument) continue
        let key = itemKey(candidate)
        if (seen.has(key)) continue
        seen.add(key)
        this.owners.set(candidate, providers[i].provider)
        items.push(candidate)
      }
    }
    return items
  }

  public handleDidShow(item: NextEditItem): void {
    let provider = this.owners.get(item)
    if (!provider?.handleDidShowNextEdit) return
    let result: void | Thenable<void>
    try {
      result = provider.handleDidShowNextEdit(item)
    } catch (err) {
      this.handleDidShowError(err)
      return
    }
    Promise.resolve(result).catch(err => this.handleDidShowError(err))
  }

  private handleDidShowError(err: any): void {
    if (!shouldIgnore(err)) {
      logger.error('Error on handleDidShowNextEdit', err)
    }
  }
}
