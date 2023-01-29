'use strict'
import { Location, Range, SymbolTag, WorkspaceSymbol } from 'vscode-languageserver-types'
import languages, { ProviderName } from '../../languages'
import { AnsiHighlight, LocationWithTarget } from '../../types'
import { toArray } from '../../util/array'
import { getSymbolKind } from '../../util/convert'
import { minimatch } from '../../util/node'
import { CancellationToken, CancellationTokenSource } from '../../util/protocol'
import { byteLength } from '../../util/string'
import workspace from '../../workspace'
import { formatUri } from '../formatting'
import { ListContext, ListItem } from '../types'
import LocationList from './location'

interface ItemToSort {
  data: {
    score?: number
    kind?: number
    file?: string
  }
}

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search workspace symbols'
  public readonly detail = 'Symbols list is provided by server, it works on interactive mode only.'
  public fuzzyMatch = workspace.createFuzzyMatch()
  public name = 'symbols'
  public options = [{
    name: '-k, -kind KIND',
    description: 'Filter symbols by kind.',
    hasValue: true
  }]

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    let { input } = context
    let args = this.parseArguments(context.args)
    let filterKind = args.kind ? args.kind.toString().toLowerCase() : ''
    if (!languages.hasProvider(ProviderName.WorkspaceSymbols, { uri: 'file:///1', languageId: '' })) {
      throw new Error('No workspace symbols provider registered')
    }
    let symbols = await languages.getWorkspaceSymbols(input, token)
    if (token.isCancellationRequested) return []
    let config = this.getConfig()
    let excludes = config.get<string[]>('excludes', [])
    let items: (ListItem & ItemToSort)[] = []
    this.fuzzyMatch.setPattern(input, true)
    for (let s of symbols) {
      let kind = getSymbolKind(s.kind)
      if (filterKind && kind.toLowerCase() != filterKind) {
        continue
      }
      let file = formatUri(s.location.uri, workspace.cwd)
      if (excludes.some(p => minimatch(file, p))) {
        continue
      }
      let item = this.createListItem(input, s, kind, file)
      items.push(item)
    }
    this.fuzzyMatch.free()
    items.sort(sortSymbolItems)
    return items
  }

  public async resolveItem(item: ListItem): Promise<ListItem | null> {
    let symbolItem = item.data.original as WorkspaceSymbol
    // no need to resolve
    if (!symbolItem || Location.is(symbolItem.location)) return null
    let tokenSource = new CancellationTokenSource()
    let resolved = await languages.resolveWorkspaceSymbol(symbolItem, tokenSource.token)
    if (!resolved) return null
    if (Location.is(resolved.location)) {
      symbolItem.location = resolved.location
      item.location = toTargetLocation(resolved.location)
    }
    return item
  }

  public createListItem(input: string, item: WorkspaceSymbol, kind: string, file: string): ListItem & ItemToSort {
    let { name } = item
    let label = ''
    let ansiHighlights: AnsiHighlight[] = []
    // Normal Typedef Comment
    let parts = [name, `[${kind}]`, file]
    let highlights = ['Normal', 'Typedef', 'Comment']
    for (let index = 0; index < parts.length; index++) {
      const text = parts[index]
      let start = byteLength(label)
      label += text
      let end = byteLength(label)
      if (index != parts.length - 1) {
        label += ' '
      }
      ansiHighlights.push({ span: [start, end], hlGroup: highlights[index] })
      if (index === 0 && ((toArray(item.tags)).includes(SymbolTag.Deprecated)) || item['deprecated']) {
        ansiHighlights.push({ span: [start, end], hlGroup: 'CocDeprecatedHighlight' })
      }
    }
    let score = 0
    if (input.length > 0) {
      let result = this.fuzzyMatch.matchHighlights(name, 'CocListSearch')
      if (result) {
        score = result.score
        ansiHighlights.push(...result.highlights)
      }
    }
    return {
      label,
      filterText: '',
      ansiHighlights,
      location: toTargetLocation(item.location),
      data: {
        original: item,
        input,
        kind: item.kind,
        file,
        score,
      }
    }
  }
}

function toTargetLocation(location: Location | { uri: string }): LocationWithTarget | Location {
  if (!Location.is(location)) {
    return Location.create(location.uri, Range.create(0, 0, 0, 0))
  }
  let loc: LocationWithTarget = Location.create(location.uri, Range.create(location.range.start, location.range.start))
  loc.targetRange = location.range
  return loc
}

export function sortSymbolItems(a: ItemToSort, b: ItemToSort): number {
  if (a.data.score != b.data.score) {
    return b.data.score - a.data.score
  }
  if (a.data.kind != b.data.kind) {
    return a.data.kind - b.data.kind
  }
  return a.data.file.length - b.data.file.length
}
