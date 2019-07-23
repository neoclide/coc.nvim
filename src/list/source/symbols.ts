import path from 'path'
import { SymbolInformation, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import LocationList from './location'
import { getSymbolKind } from '../../util/convert'
import { isParentFolder } from '../../util/fs'
import { score } from '../../util/fzy'
const logger = require('../../util/logger')('list-symbols')

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search workspace symbols'
  public readonly detail = 'Symbols list is provided by server, it works on interactive mode only.'
  public name = 'symbols'

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let buf = await context.window.buffer
    let document = workspace.getDocument(buf.id)
    if (!document) return null
    let { input } = context
    if (!context.options.interactive) {
      throw new Error('Symbols only works on interactive mode')
    }
    let symbols = await languages.getWorkspaceSymbols(document.textDocument, input)
    if (!symbols) {
      throw new Error('Workspace symbols provider not found for current document')
    }
    let items: ListItem[] = []
    for (let s of symbols) {
      let kind = getSymbolKind(s.kind)
      let file = URI.parse(s.location.uri).fsPath
      if (isParentFolder(workspace.cwd, file)) {
        file = path.relative(workspace.cwd, file)
      }
      items.push({
        label: `${s.name} [${kind}]\t${file}`,
        filterText: `${s.name}`,
        location: s.location,
        data: { original: s, kind: s.kind, file, score: score(input, s.name) }
      })
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
    let resolved = await languages.resolveWorkspaceSymbol(s)
    if (!resolved) return null
    let kind = getSymbolKind(resolved.kind)
    let file = URI.parse(resolved.location.uri).fsPath
    if (isParentFolder(workspace.cwd, file)) {
      file = path.relative(workspace.cwd, file)
    }
    return {
      label: `${s.name} [${kind}]\t${file}`,
      filterText: `${s.name}`,
      location: s.location
    }
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocSymbolsName /\\v^\\s*\\S+/ contained containedin=CocSymbolsLine', true)
    nvim.command('syntax match CocSymbolsKind /\\[\\w\\+\\]\\t/ contained containedin=CocSymbolsLine', true)
    nvim.command('syntax match CocSymbolsFile /\\S\\+$/ contained containedin=CocSymbolsLine', true)
    nvim.command('highlight default link CocSymbolsName Normal', true)
    nvim.command('highlight default link CocSymbolsKind Typedef', true)
    nvim.command('highlight default link CocSymbolsFile Comment', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}
