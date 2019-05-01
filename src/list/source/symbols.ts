import path from 'path'
import { SymbolInformation, SymbolKind } from 'vscode-languageserver-types'
import Uri from 'vscode-uri'
import languages from '../../languages'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import LocationList from './location'
import { getSymbolKind } from '../../util/convert'
const logger = require('../../util/logger')('list-symbols')

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search workspace symbols'
  public readonly detail = 'Symbols list if provided by server, it works on interactive mode only.\n'
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
      if (!this.validWorkspaceSymbol(s)) continue
      let kind = getSymbolKind(s.kind)
      let file = Uri.parse(s.location.uri).fsPath
      if (file.startsWith(workspace.cwd)) {
        file = path.relative(workspace.cwd, file)
      }
      items.push({
        label: `${s.name} [${kind}]\t${file}`,
        filterText: `${s.name}`,
        location: s.location,
        data: { original: s }
      })
    }
    return items
  }

  public async resolveItem(item: ListItem): Promise<ListItem> {
    let s = item.data.original
    if (!s) return null
    let resolved = await languages.resolveWorkspaceSymbol(s)
    if (!resolved) return null
    let kind = getSymbolKind(resolved.kind)
    let file = Uri.parse(resolved.location.uri).fsPath
    if (file.startsWith(workspace.cwd)) {
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

  private validWorkspaceSymbol(symbol: SymbolInformation): boolean {
    switch (symbol.kind) {
      case SymbolKind.Namespace:
      case SymbolKind.Class:
      case SymbolKind.Module:
      case SymbolKind.Method:
      case SymbolKind.Package:
      case SymbolKind.Interface:
      case SymbolKind.Function:
      case SymbolKind.Constant:
        return true
      default:
        return false
    }
  }
}
