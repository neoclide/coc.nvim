'use strict'
import { Definition, Disposable, DocumentSelector, Location, LocationLink } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import workspace from '../workspace'
import { equals } from '../util/object'
const logger = require('../util/logger')('provider-manager')

export type ProviderItem<T, P = object> = {
  id: string
  selector: DocumentSelector
  provider: T
  priority?: number
} & P

export default class Manager<T, P = object> {
  protected providers: Set<ProviderItem<T, P>> = new Set()

  public hasProvider(document: TextDocument): boolean {
    return this.getProvider(document) != null
  }

  protected addProvider(item: ProviderItem<T, P>): Disposable {
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  protected handleResults(results: PromiseSettledResult<void>[], name: string): void {
    results.forEach(res => {
      if (res.status === 'rejected') {
        logger.error(`Provider error on ${name}:`, res.reason)
      }
    })
  }

  protected getProvider(document: TextDocument): ProviderItem<T, P> {
    let currScore = 0
    let providerItem: ProviderItem<T, P>
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

  protected getProviderById(id: string): T {
    let item = Array.from(this.providers).find(o => o.id == id)
    return item ? item.provider : null
  }

  protected getProviders(document: TextDocument): ProviderItem<T, P>[] {
    let items = Array.from(this.providers)
    items = items.filter(item => workspace.match(item.selector, document) > 0)
    return items.sort((a, b) => workspace.match(b.selector, document) - workspace.match(a.selector, document))
  }

  protected addLocation(locations: Location[], location: Location | Location[] | LocationLink[]): void {
    if (Array.isArray(location)) {
      location.forEach(loc => {
        if (Location.is(loc)) {
          addLocation(locations, loc)
        } else if (LocationLink.is(loc)) {
          let { targetUri, targetSelectionRange, targetRange } = loc
          addLocation(locations, Location.create(targetUri, targetSelectionRange ?? targetRange))
        }
      })
    } else if (Location.is(location)) {
      addLocation(locations, location)
    }
  }

  protected toLocations(arr: (Definition | LocationLink[] | null)[]): Location[] {
    let res: Location[] = []
    for (let def of arr) {
      if (!def) continue
      if (Location.is(def)) {
        addLocation(res, def)
      } else if (Array.isArray(def)) {
        for (let d of def) {
          if (Location.is(d)) {
            addLocation(res, d)
          } else if (LocationLink.is(d)) {
            let { targetUri, targetSelectionRange, targetRange } = d
            addLocation(res, Location.create(targetUri, targetSelectionRange || targetRange))
          }
        }
      } else {
        logger.error(`Bad definition`, def)
      }
    }
    return res
  }
}

/**
 * Add unique location
 */
function addLocation(arr: Location[], location: Location): void {
  let { range, uri } = location
  if (arr.find(o => o.uri == uri && equals(o.range, range)) != null) return
  arr.push(location)
}
