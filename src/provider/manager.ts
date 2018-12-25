import { Definition, DocumentSelector, Location, TextDocument } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
const logger = require('../util/logger')('provider-manager')

export interface ProviderItem<T> {
  id: string,
  selector: DocumentSelector
  provider: T
  [index: string]: any
}

export default class Manager<T> {
  protected providers: Set<ProviderItem<T>> = new Set()

  public hasProvider(document: TextDocument): boolean {
    return this.getProvider(document) != null
  }

  protected getProvider(document: TextDocument): ProviderItem<T> {
    let currScore = 0
    let providerItem: ProviderItem<T>
    for (let item of this.providers) {
      let { selector, priority } = item
      let score = workspace.match(selector, document)
      if (score == 0) continue
      if (typeof priority == 'number') {
        score = priority
      }
      if (score < currScore) continue
      currScore = score
      providerItem = item
    }
    return providerItem
  }

  protected poviderById(id): T {
    let item = Array.from(this.providers).find(o => o.id == id)
    return item ? item.provider : null
  }

  protected getProviders(document: TextDocument): ProviderItem<T>[] {
    let items = Array.from(this.providers)
    items = items.filter(item => {
      return workspace.match(item.selector, document) > 0
    })
    return items.sort((a, b) => {
      return workspace.match(b.selector, document) - workspace.match(a.selector, document)
    })
  }

  protected mergeDefinitions(arr: Definition[]): Location[] {
    let res: Location[] = []
    for (let def of arr) {
      if (!def) continue
      if (Location.is(def)) {
        let { uri, range } = def
        let idx = res.findIndex(l => l.uri == uri && l.range.start.line == range.start.line)
        if (idx == -1) {
          res.push(def)
        }
      } else if (Array.isArray(def)) {
        for (let d of def) {
          let { uri, range } = d
          let idx = res.findIndex(l => l.uri == uri && l.range.start.line == range.start.line)
          if (idx == -1) {
            res.push(d)
          }
        }
      } else {
        workspace.showMessage(`Bad definition ${JSON.stringify(def)}`, 'error')
      }
    }
    return res
  }
}
