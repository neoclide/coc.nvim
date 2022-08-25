'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, Position, TypeHierarchyItem } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { TypeHierarchyProvider } from './index'
import Manager from './manager'

interface TypeHierarchyItemWithSource extends TypeHierarchyItem {
  source?: string
}

export default class TypeHierarchyManager extends Manager<TypeHierarchyProvider> {

  public register(selector: DocumentSelector, provider: TypeHierarchyProvider): Disposable {
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
  public async prepareTypeHierarchy(document: TextDocument, position: Position, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    const items = this.getProviders(document)
    if (items.length === 0) return []
    let hierarchyItems: TypeHierarchyItemWithSource[] = []
    let index = 0
    let results = await Promise.allSettled(items.map(item => {
      let { provider, id } = item
      return Promise.resolve(provider.prepareTypeHierarchy(document, position, token)).then(arr => {
        if (Array.isArray(arr)) {
          arr.forEach(hierarchyItem => {
            if (index == 0 || !hierarchyItems.some(o => o.name === hierarchyItem.name)) {
              hierarchyItems.push(Object.assign({ source: id }, hierarchyItem))
            }
          })
        }
        index++
      })
    }))
    this.handleResults(results, 'prepareTypeHierarchy')
    return hierarchyItems
  }

  public async provideTypeHierarchySupertypes(item: TypeHierarchyItemWithSource, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    const provider = this.getProviderById(item.source)
    return await Promise.resolve(provider.provideTypeHierarchySupertypes(item, token))
  }

  public async provideTypeHierarchySubtypes(item: TypeHierarchyItemWithSource, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    const provider = this.getProviderById(item.source)
    return await Promise.resolve(provider.provideTypeHierarchySubtypes(item, token))
  }
}
