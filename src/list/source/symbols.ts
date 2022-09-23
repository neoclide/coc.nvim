'use strict'
import minimatch from 'minimatch'
import path from 'path'
import { CancellationToken, CancellationTokenSource, SymbolInformation } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { FuzzyMatch } from '../../model/fuzzyMatch'
import { AnsiHighlight, ListContext, ListItem } from '../../types'
import bytes from '../../util/bytes'
import { getSymbolKind } from '../../util/convert'
import { isParentFolder } from '../../util/fs'
import { mergePositions } from '../../util/fuzzy'
import { byteLength } from '../../util/string'
import workspace from '../../workspace'
import LocationList from './location'
const logger = require('../../util/logger')('list-symbols')

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search workspace symbols'
  public readonly detail = 'Symbols list is provided by server, it works on interactive mode only.'
  private fuzzyMatch = new FuzzyMatch()
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
    if (!languages.hasProvider('workspaceSymbols', TextDocument.create('file:///1', '', 1, ''))) {
      throw new Error('No workspace symbols provider registered')
    }
    let symbols = await languages.getWorkspaceSymbols(input, token)
    await this.fuzzyMatch.load()
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
    item.location = resolved.location
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
      let result = this.fuzzyMatch.match(name)
      if (result) {
        let byteIndex = bytes(name)
        score = result.score
        mergePositions(result.positions, (start, end) => {
          ansiHighlights.push({
            span: [byteIndex(start), byteIndex(end) + 1],
            hlGroup: 'CocListSearch'
          })
        })
      }
    }
    return {
      label,
      filterText: '',
      ansiHighlights,
      location: item.location,
      data: {
        original: item, input, kind: item.kind, file, score,
      }
    }
  }

  public doHighlight(): void {
  }
}
