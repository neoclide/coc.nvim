'use strict'
import { Location, LocationLink } from 'vscode-languageserver-types'
import { createLogger } from '../logger'
import { LocationWithTarget, TextDocumentMatch } from '../types'
import { isCancellationError, shouldIgnore } from '../util/errors'
import { parseExtensionName } from '../util/extensionRegistry'
import { equals } from '../util/object'
import { CancellationToken, Disposable } from '../util/protocol'
import { toText } from '../util/string'
import workspace from '../workspace'
import { DocumentSelector } from './index'
const logger = createLogger('provider-manager')

export type ProviderItem<T extends object, P = object> = {
  id: string
  selector: DocumentSelector
  provider: T
  priority?: number
} & P

export default class Manager<T extends object, P = object> {
  protected providers: Set<ProviderItem<T, P>> = new Set()

  public hasProvider(document: TextDocumentMatch): boolean {
    return this.getProvider(document) != null
  }

  protected addProvider(item: ProviderItem<T, P>): Disposable {
    if (!item.provider.hasOwnProperty('__extensionName')) {
      Error.captureStackTrace(item)
      let name: string
      Object.defineProperty(item.provider, '__extensionName', {
        get: () => {
          if (name) return name
          name = parseExtensionName(toText(item['stack']))
          return name
        },
        enumerable: true
      })
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  protected handleResults(results: PromiseSettledResult<void>[], name: string, token?: CancellationToken): void {
    let serverCancelError: Error
    results.forEach(res => {
      if (res.status === 'rejected') {
        if (!shouldIgnore(res.reason)) logger.error(`Provider error on ${name}:`, res.reason)
        if (token && !token.isCancellationRequested && isCancellationError(res.reason)) {
          serverCancelError = res.reason
        }
      }
    })
    if (serverCancelError) throw serverCancelError
  }

  protected getProvider(document: TextDocumentMatch): ProviderItem<T, P> {
    let currScore = 0
    let providerItem: ProviderItem<T, P>
    for (let item of this.providers) {
      let { selector, priority } = item
      let score = workspace.match(selector, document)
      if (score == 0) continue
      if (typeof priority == 'number' && priority > 0) {
        score = score + priority
      }
      if (score < currScore) continue
      currScore = score
      providerItem = item
    }
    return providerItem
  }

  public getProvideByExtension(document: TextDocumentMatch, extension: string): ProviderItem<T, P> {
    for (let item of this.providers) {
      if (item.provider['__extensionName'] === extension) {
        return item
      }
    }
    logger.warn(`User-specified formatter not found for ${document.languageId}:`, extension)
    return undefined
  }

  protected getFormatProvider(document: TextDocumentMatch): ProviderItem<T, P> {
    // Prefer user choice
    const userChoice = workspace.getConfiguration('coc.preferences', document).get<string>('formatterExtension')
    if (userChoice) {
      let provider = this.getProvideByExtension(document, userChoice)
      if (provider) return provider
    }
    return this.getProvider(document)
  }

  protected getProviderById(id: string): T {
    let item = Array.from(this.providers).find(o => o.id == id)
    return item ? item.provider : null
  }

  public getProviders(document: TextDocumentMatch): ProviderItem<T, P>[] {
    let items = Array.from(this.providers)
    items = items.filter(item => workspace.match(item.selector, document) > 0)
    return items.sort((a, b) => workspace.match(b.selector, document) - workspace.match(a.selector, document))
  }

  public addLocation(locations: LocationWithTarget[], location: Location | Location[] | LocationLink[] | null | undefined): void {
    if (Array.isArray(location)) {
      for (let loc of location) {
        if (Location.is(loc)) {
          addLocation(locations, loc)
        } else if (loc && typeof loc.targetUri === 'string') {
          addLocation(locations, loc)
        }
      }
    } else if (Location.is(location)) {
      addLocation(locations, location)
    }
  }
}

/**
 * Add unique location
 */
function addLocation(arr: LocationWithTarget[], location: Location | LocationLink): void {
  if (Location.is(location)) {
    let { range, uri } = location
    if (arr.find(o => o.uri == uri && equals(o.range, range)) != null) return
    arr.push(location)
  } else if (location && typeof location.targetUri === 'string') {
    let { targetUri, targetSelectionRange, targetRange } = location
    if (arr.find(o => o.uri == targetUri && equals(o.range, targetSelectionRange)) != null) return
    arr.push({
      uri: targetUri,
      range: targetSelectionRange,
      targetRange
    })
  }
}
