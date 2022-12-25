'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentSymbol, SymbolInformation, SymbolTag } from 'vscode-languageserver-types'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { compareRangesUsingStarts, equalsRange, rangeInRange } from '../util/position'
import { CancellationToken, Disposable } from '../util/protocol'
import { toText } from '../util/string'
import { DocumentSelector, DocumentSymbolProvider, DocumentSymbolProviderMetadata } from './index'
import Manager from './manager'

export default class DocumentSymbolManager extends Manager<DocumentSymbolProvider> {
  public register(selector: DocumentSelector, provider: DocumentSymbolProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public getMetaData(document: TextDocument): DocumentSymbolProviderMetadata | null {
    let item = this.getProvider(document)
    if (!item) return null
    return item.provider.meta ?? {}
  }

  public async provideDocumentSymbols(
    document: TextDocument,
    token: CancellationToken
  ): Promise<DocumentSymbol[] | null> {
    let item = this.getProvider(document)
    if (!item) return null
    let symbols: DocumentSymbol[] | null = []
    let results = await Promise.allSettled([item].map(item => {
      return Promise.resolve(item.provider.provideDocumentSymbols(document, token)).then(result => {
        if (!token.isCancellationRequested && !isFalsyOrEmpty(result)) {
          if (DocumentSymbol.is(result[0])) {
            symbols = result as DocumentSymbol[]
          } else {
            symbols = asDocumentSymbolTree(result as SymbolInformation[])
          }
        }
      })
    }))
    this.handleResults(results, 'provideDocumentSymbols')
    return symbols
  }
}

export function asDocumentSymbolTree(infos: SymbolInformation[]): DocumentSymbol[] {
  infos = infos.slice().sort((a, b) => {
    return compareRangesUsingStarts(a.location.range, b.location.range)
  })
  const res: DocumentSymbol[] = []
  const parentStack: DocumentSymbol[] = []
  for (const info of infos) {
    const element: DocumentSymbol = {
      name: toText(info.name),
      kind: info.kind,
      tags: toArray(info.tags),
      detail: '',
      range: info.location.range,
      selectionRange: info.location.range,
    }
    if (info.deprecated) {
      element.tags.push(SymbolTag.Deprecated)
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (parentStack.length === 0) {
        parentStack.push(element)
        res.push(element)
        break
      }
      const parent = parentStack[parentStack.length - 1]
      if (rangeInRange(element.range, parent.range) && !equalsRange(parent.range, element.range)) {
        parent.children = toArray(parent.children)
        parent.children.push(element)
        parentStack.push(element)
        break
      }
      parentStack.pop()
    }
  }
  return res
}
