'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentLink, DocumentSelector } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { omit } from '../util/lodash'
import { equals } from '../util/object'
import { DocumentLinkProvider } from './index'
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
    const results = await Promise.allSettled(items.map(item => {
      let { id, provider } = item
      return Promise.resolve(provider.provideDocumentLinks(document, token)).then(arr => {
        if (Array.isArray(arr)) {
          arr.forEach(link => {
            if (!links.some(l => equals(l.range, link.range))) {
              links.push(Object.assign({ source: id }, link))
            }
          })
        }
      })
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
