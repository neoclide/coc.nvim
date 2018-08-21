import { CancellationToken, Disposable, DocumentLink, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { DocumentLinkProvider } from './index'
import uuid = require('uuid/v4')

export interface ProviderItem {
  id: string
  selector: DocumentSelector
  provider: DocumentLinkProvider
}

export default class DocumentLinkManager implements Disposable {
  private providers: Set<ProviderItem> = new Set()

  public register(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable {
    let item: ProviderItem = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  private getProviders(document: TextDocument): ProviderItem[] | null {
    let items = Array.from(this.providers)
    return items.filter(item => {
      return workspace.match(item.selector, document) > 0
    })
  }

  private async _provideDocumentLinks(item: ProviderItem, document: TextDocument, token: CancellationToken): Promise<DocumentLink[]> {
    let { provider, id } = item
    let items = await Promise.resolve(provider.provideDocumentLinks(document, token))
    if (!items || !items.length) return []
    items.forEach(item => {
      item.data = item.data || {}
      item.data.source = id
    })
    return items
  }

  public async provideDocumentLinks(document: TextDocument, token: CancellationToken): Promise<DocumentLink[]> {
    let items = this.getProviders(document)
    if (items.length == 0) return []
    const arr = await Promise.all(items.map(item => {
      return this._provideDocumentLinks(item, document, token)
    }))
    return [].concat(...arr)
  }

  public async resolveDocumentLink(link: DocumentLink, token: CancellationToken): Promise<DocumentLink> {
    let { data } = link
    if (!data || !data.source) return null
    for (let item of this.providers) {
      if (item.id == data.source) {
        let { provider } = item
        link = await Promise.resolve(provider.resolveDocumentLink(link, token))
        return link
      }
    }
    return null
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
