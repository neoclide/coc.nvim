'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentLink, Range } from 'vscode-languageserver-types'
import { omit } from '../util/lodash'
import { CancellationToken, Disposable } from '../util/protocol'
import { DocumentLinkProvider, DocumentSelector } from './index'
import Manager from './manager'

interface DocumentLinkWithSource extends DocumentLink {
  source?: string
}

export default class DocumentLinkManager extends Manager<DocumentLinkProvider> {

  public register(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideDocumentLinks(document: TextDocument, token: CancellationToken): Promise<DocumentLinkWithSource[] | null> {
    let items = this.getProviders(document)
    if (items.length == 0) return null
    const links: DocumentLinkWithSource[] = []
    const seenRanges: Set<string> = new Set()

    function rangeToString(range: Range): string {
      return `${range.start.line},${range.start.character},${range.end.line},${range.end.character}`
    }

    const results = await Promise.allSettled(items.map(async item => {
      let { id, provider } = item
      const arr = await provider.provideDocumentLinks(document, token)
      if (Array.isArray(arr)) {
        arr.forEach(link => {
          const rangeString = rangeToString(link.range)
          if (!seenRanges.has(rangeString)) {
            seenRanges.add(rangeString)
            links.push(Object.assign({ source: id }, link))
          }
        })
      }
    }))
    this.handleResults(results, 'provideDocumentLinks')
    return links
  }

  public async resolveDocumentLink(link: DocumentLinkWithSource, token: CancellationToken): Promise<DocumentLink> {
    let provider = this.getProviderById(link.source)
    if (typeof provider.resolveDocumentLink === 'function') {
      let resolved = await Promise.resolve(provider.resolveDocumentLink(omit(link, ['source']), token))
      if (resolved) Object.assign(link, resolved)
    }
    return link
  }
}
