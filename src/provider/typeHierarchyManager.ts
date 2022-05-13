'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Position, TypeHierarchyItem } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { TypeHierarchyProvider } from './index'
import Manager, { ProviderItem } from './manager'

export default class TypeHierarchyManager extends Manager<TypeHierarchyProvider> {

  public register(selector: DocumentSelector, provider: TypeHierarchyProvider): Disposable {
    let item: ProviderItem<TypeHierarchyProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async prepareTypeHierarchy(document: TextDocument, position: Position, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    const item = this.getProvider(document)
    if (!item) return []

    const { provider, id } = item
    if (provider.prepareTypeHierarchy === null) return []

    const items = await Promise.resolve(provider.prepareTypeHierarchy(document, position, token))
    if (!items || !items.length) return []
    items.forEach(item => {
      item.data = item.data || {}
      item.data.source = id
    })
    return items
  }

  public async provideTypeHierarchySupertypes(item: TypeHierarchyItem, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    const { data } = item
    if (!data || !data.source) return []

    const provider = this.getProviderById(item.data.source)
    if (provider.provideTypeHierarchySupertypes === null) return []

    return await Promise.resolve(provider.provideTypeHierarchySupertypes(item, token))
  }

  public async provideTypeHierarchySubtypes(item: TypeHierarchyItem, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    const { data } = item
    if (!data || !data.source) return []

    const provider = this.getProviderById(item.data.source)
    if (provider.provideTypeHierarchySubtypes === null) return []

    return await Promise.resolve(provider.provideTypeHierarchySubtypes(item, token))
  }
}
