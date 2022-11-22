'use strict'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { Location, Range, SymbolInformation } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages, { ProviderName } from '../../languages'
import { AnsiHighlight, LocationWithTarget } from '../../types'
import { ListContext, ListItem } from '../types'
import { getSymbolKind } from '../../util/convert'
import { isParentFolder } from '../../util/fs'
import { minimatch, path } from '../../util/node'
import { CancellationToken, CancellationTokenSource } from '../../util/protocol'
import { byteLength } from '../../util/string'
import workspace from '../../workspace'
import LocationList from './location'

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search workspace symbols'
  public readonly detail = 'Symbols list is provided by server, it works on interactive mode only.'
  private fuzzyMatch = workspace.createFuzzyMatch()
  public name = 'symbols'
  public options = [{
    name: '-k, -kind KIND',
    description: 'Filter symbols by kind.',
    hasValue: true
  }]

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    let { input } = context
    let args = this.parseArguments(context.args)
    let filterKind = args.kind ? (args.kind as string).toLowerCase() : ''
    if (!context.options.interactive) {
      throw new Error('Symbols only works on interactive mode')
    }
    if (!languages.hasProvider(ProviderName.WorkspaceSymbols, TextDocument.create('file:///1', '', 1, ''))) {
      throw new Error('No workspace symbols provider registered')
    }
    let symbols = await languages.getWorkspaceSymbols(input, token)
    let config = this.getConfig()
    let excludes = config.get<string[]>('excludes', [])
    let items: ListItem[] = []
    if (input.length > 0) this.fuzzyMatch.setPattern(input, true)
    for (let s of symbols) {
      let kind = getSymbolKind(s.kind)
      if (filterKind && kind.toLowerCase() != filterKind) {
        continue
      }
      let file: string | undefined
      if (s.location) {
        file = URI.parse(s.location.uri).fsPath
        if (isParentFolder(workspace.cwd, file)) {
          file = path.relative(workspace.cwd, file)
        }
        if (excludes.some(p => minimatch(file, p))) {
          continue
        }
      }
      let item = this.createListItem(input, s, kind, file)
      items.push(item)
    }
    this.fuzzyMatch.free()
    items.sort((a, b) => {
      if (a.data.score != b.data.score) {
        return b.data.score - a.data.score
      }
      if (a.data.kind != b.data.kind) {
        return a.data.kind - b.data.kind
      }
      return a.data.file.length - b.data.file.length
    })
    return items
  }

  public async resolveItem(item: ListItem): Promise<ListItem> {
    let s = item.data.original
    if (!s) return null
    let tokenSource = new CancellationTokenSource()
    let resolved = await languages.resolveWorkspaceSymbol(s, tokenSource.token)
    if (!resolved) return null
    s.location = resolved.location
    item.location = toTargetLocation(resolved.location)
    return item
  }

  public createListItem(input: string, item: SymbolInformation, kind: string, file: string): ListItem {
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
        original: item, input, kind: item.kind, file, score,
      }
    }
  }

  public doHighlight(): void {
  }
}

function toTargetLocation(location: Location): LocationWithTarget {
  let loc: LocationWithTarget = Location.create(location.uri, Range.create(location.range.start, location.range.start))
  loc.targetRange = location.range
  return loc
}
