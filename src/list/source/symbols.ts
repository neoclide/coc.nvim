'use strict'
import path from 'path'
import minimatch from 'minimatch'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { AnsiHighlight, ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import LocationList from './location'
import { getSymbolKind } from '../../util/convert'
import { isParentFolder } from '../../util/fs'
import { score } from '../../util/fzy'
import { CancellationToken, CancellationTokenSource, Location } from 'vscode-languageserver-protocol'
import { byteLength } from '../../util/string'
import { getMatchHighlights } from '../../util/score'
const logger = require('../../util/logger')('list-symbols')

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search workspace symbols'
  public readonly detail = 'Symbols list is provided by server, it works on interactive mode only.'
  private cwd: string
  public name = 'symbols'
  public options = [{
    name: '-k, -kind KIND',
    description: 'Filter symbols by kind.',
    hasValue: true
  }]

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    let { input } = context
    this.cwd = context.cwd
    let args = this.parseArguments(context.args)
    let filterKind = args.kind ? (args.kind as string).toLowerCase() : ''
    if (!context.options.interactive) {
      throw new Error('Symbols only works on interactive mode')
    }
    let symbols = await languages.getWorkspaceSymbols(input, token)
    if (!symbols) {
      throw new Error('No workspace symbols provider registered')
    }
    let config = this.getConfig()
    let excludes = config.get<string[]>('excludes', [])
    let items: ListItem[] = []
    for (let s of symbols) {
      let kind = getSymbolKind(s.kind)
      if (filterKind && kind.toLowerCase() != filterKind) {
        continue
      }
      let file = URI.parse(s.location.uri).fsPath
      if (isParentFolder(workspace.cwd, file)) {
        file = path.relative(workspace.cwd, file)
      }
      if (excludes.some(p => minimatch(file, p))) {
        continue
      }
      let item = createItem(input, s.name, kind, file, s.location)
      item.data = { original: s, input, kind: s.kind, file, score: score(input, s.name) }
      items.push(item)
    }
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
    let kind = getSymbolKind(resolved.kind)
    let file = URI.parse(resolved.location.uri).fsPath
    if (isParentFolder(this.cwd, file)) {
      file = path.relative(this.cwd, file)
    }
    return createItem(item.data.input, s.name, kind, file, s.location)
  }

  public doHighlight(): void {
  }
}

function createItem(input: string, name: string, kind: string, file: string, location: Location): ListItem {
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
  let arr = getMatchHighlights(input, name, 0, 'CocListSearch')
  ansiHighlights.push(...arr)
  return {
    label,
    filterText: '',
    ansiHighlights,
    location
  }
}
