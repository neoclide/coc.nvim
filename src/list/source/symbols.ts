import { Neovim } from '@chemzqm/neovim'
import { ListContext, ListItem } from '../../types'
import LocationList from './location'
import path from 'path'
import languages from '../../languages'
import workspace from '../../workspace'
import { SymbolInformation, SymbolKind } from 'vscode-languageserver-types'
import Uri from 'vscode-uri'
const logger = require('../../util/logger')('list-symbols')

export default class Symbols extends LocationList {
  public readonly interactive = true
  public readonly description = 'search for workspace symbols'

  constructor(nvim: Neovim) {
    super(nvim)
  }

  public get name(): string {
    return 'symbols'
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let { input } = context
    let buf = await context.window.buffer
    let document = workspace.getDocument(buf.id)
    if (!document) return []
    let symbols = await languages.getWorkspaceSymbols(document.textDocument, input)
    if (!symbols) return []
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
        location: s.location
      })
    }
    return items
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
    nvim.resumeNotification()
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

function getSymbolKind(kind: SymbolKind): string {
  switch (kind) {
    case SymbolKind.File:
      return 'File'
    case SymbolKind.Module:
      return 'Module'
    case SymbolKind.Namespace:
      return 'Namespace'
    case SymbolKind.Package:
      return 'Package'
    case SymbolKind.Class:
      return 'Class'
    case SymbolKind.Method:
      return 'Method'
    case SymbolKind.Property:
      return 'Property'
    case SymbolKind.Field:
      return 'Field'
    case SymbolKind.Constructor:
      return 'Constructor'
    case SymbolKind.Enum:
      return 'Enum'
    case SymbolKind.Interface:
      return 'Interface'
    case SymbolKind.Function:
      return 'Function'
    case SymbolKind.Variable:
      return 'Variable'
    case SymbolKind.Constant:
      return 'Constant'
    case SymbolKind.String:
      return 'String'
    case SymbolKind.Number:
      return 'Number'
    case SymbolKind.Boolean:
      return 'Boolean'
    case SymbolKind.Array:
      return 'Array'
    case SymbolKind.Object:
      return 'Object'
    case SymbolKind.Key:
      return 'Key'
    case SymbolKind.Null:
      return 'Null'
    case SymbolKind.EnumMember:
      return 'EnumMember'
    case SymbolKind.Struct:
      return 'Struct'
    case SymbolKind.Event:
      return 'Event'
    case SymbolKind.Operator:
      return 'Operator'
    case SymbolKind.TypeParameter:
      return 'TypeParameter'
    default:
      return 'Unknown'
  }
}
