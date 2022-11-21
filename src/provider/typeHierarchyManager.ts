'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Position, TypeHierarchyItem } from 'vscode-languageserver-types'
import { omit } from '../util/lodash'
import { CancellationToken, Disposable } from '../util/protocol'
import { TypeHierarchyProvider, DocumentSelector } from './index'
import Manager from './manager'

export interface TypeHierarchyItemWithSource extends TypeHierarchyItem {
  source?: string
}

const excludeKeys = ['source']

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
    let hierarchyItems: TypeHierarchyItemWithSource[] = []
    let results = await Promise.allSettled(items.map(item => {
      let { provider, id } = item
      return (async () => {
        let arr = await Promise.resolve(provider.prepareTypeHierarchy(document, position, token))
        if (Array.isArray(arr)) {
          let noCheck = hierarchyItems.length === 0
          arr.forEach(item => {
            if (noCheck || hierarchyItems.every(o => o.name !== item.name)) {
              hierarchyItems.push(Object.assign({ source: id }, item))
            }
          })
        }
      })()
    }))
    this.handleResults(results, 'prepareTypeHierarchy')
    return hierarchyItems
  }

  public async provideTypeHierarchySupertypes(item: TypeHierarchyItemWithSource, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    let { source } = item
    const provider = this.getProviderById(source)
    if (!provider) return []
    return await Promise.resolve(provider.provideTypeHierarchySupertypes(omit(item, excludeKeys), token)).then(arr => {
      if (Array.isArray(arr)) {
        return arr.map(item => {
          return Object.assign({ source }, item)
        })
      }
      return []
    })
  }

  public async provideTypeHierarchySubtypes(item: TypeHierarchyItemWithSource, token: CancellationToken): Promise<TypeHierarchyItem[]> {
    let { source } = item
    const provider = this.getProviderById(source)
    if (!provider) return []
    return await Promise.resolve(provider.provideTypeHierarchySubtypes(omit(item, excludeKeys), token)).then(arr => {
      if (Array.isArray(arr)) {
        return arr.map(item => {
          return Object.assign({ source }, item)
        })
      }
      return []
    })
  }
}
