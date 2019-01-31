import { Neovim } from '@chemzqm/neovim'
import { DocumentSymbol, Location, SymbolInformation, SymbolKind } from 'vscode-languageserver-types'
import languages from '../../languages'
import { ListContext, ListItem } from '../../types'
import workspace from '../../workspace'
import LocationList from './location'
const logger = require('../../util/logger')('list-symbols')

export default class Outline extends LocationList {
  public readonly description = 'symbols of current document'

  constructor(nvim: Neovim) {
    super(nvim)
  }

  public get name(): string {
    return 'outline'
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let buf = await context.window.buffer
    let document = workspace.getDocument(buf.id)
    if (!document) return null
    let symbols = await languages.getDocumentSymbol(document.textDocument)
    if (!symbols || symbols.length == 0) return []
    let items: ListItem[] = []
    let isSymbols = !symbols[0].hasOwnProperty('location')
    if (isSymbols) {
      (symbols as DocumentSymbol[]).sort(sortSymbols)
      for (let s of symbols as DocumentSymbol[]) {
        let kind = getSymbolKind(s.kind)
        let location = Location.create(document.uri, s.range)
        items.push({
          label: `${s.name} [${kind}]`,
          filterText: `${s.name}`,
          location
        })
        if (s.children && s.children.length) {
          for (let item of s.children) {
            let location = Location.create(document.uri, item.range)
            let kind = getSymbolKind(item.kind)
            items.push({
              label: `${item.name} [${kind}]`,
              filterText: `${item.name}`,
              location
            })
          }
        }
      }
    } else {
      (symbols as SymbolInformation[]).sort((a, b) => {
        let sa = a.location.range.start
        let sb = b.location.range.start
        let d = sa.line - sb.line
        return d == 0 ? sa.character - sb.character : d
      })
      for (let s of symbols as SymbolInformation[]) {
        let kind = getSymbolKind(s.kind)
        items.push({
          label: `${s.name} [${kind}]`,
          filterText: `${s.name}`,
          location: s.location
        })
      }
    }
    logger.debug('items:', items)
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocOutlineName /\\v^\\s*\\S+/ contained containedin=CocOutlineLine', true)
    nvim.command('syntax match CocOutlineKind /\\[\\w\\+\\]/ contained containedin=CocOutlineLine', true)
    nvim.command('highlight default link CocOutlineName Normal', true)
    nvim.command('highlight default link CocOutlineKind Typedef', true)
    nvim.resumeNotification()
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

function sortSymbols(a: DocumentSymbol, b: DocumentSymbol): number {
  let ra = a.selectionRange
  let rb = b.selectionRange
  if (ra.start.line < rb.start.line) {
    return -1
  }
  if (ra.start.line > rb.start.line) {
    return 1
  }
  return ra.start.character - rb.start.character
}
