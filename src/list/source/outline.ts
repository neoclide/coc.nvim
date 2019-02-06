import path from 'path'
import { DocumentSymbol, Location, Range, SymbolInformation, SymbolKind } from 'vscode-languageserver-types'
import Uri from 'vscode-uri'
import languages from '../../languages'
import Document from '../../model/document'
import { ListContext, ListItem } from '../../types'
import { runCommand } from '../../util'
import { writeFile } from '../../util/fs'
import workspace from '../../workspace'
import LocationList from './location'
const logger = require('../../util/logger')('list-symbols')

export default class Outline extends LocationList {
  public readonly description = 'symbols of current document'
  public name = 'outline'

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let buf = await context.window.buffer
    let document = workspace.getDocument(buf.id)
    if (!document) return null
    let symbols = await languages.getDocumentSymbol(document.textDocument)
    if (!symbols) return await this.loadCtagsSymbols(document)
    if (symbols.length == 0) return []
    let items: ListItem[] = []
    let isSymbols = !symbols[0].hasOwnProperty('location')
    if (isSymbols) {
      function addSymbols(symbols: DocumentSymbol[], level = 0): void {
        symbols.sort(sortSymbols)
        for (let s of symbols) {
          let kind = getSymbolKind(s.kind)
          if (kind == 'Variable') continue
          let location = Location.create(document.uri, s.selectionRange)
          items.push({
            label: `${' '.repeat(level * 2)}${s.name} [${kind}] ${s.range.start.line + 1}`,
            filterText: `${s.name}`,
            location
          })
          if (s.children && s.children.length) {
            addSymbols(s.children, level + 1)
          }
        }
      }
      addSymbols(symbols as DocumentSymbol[])
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
          label: `${s.name} [${kind}] ${s.location.range.start.line + 1}`,
          filterText: `${s.name}`,
          location: s.location
        })
      }
    }
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocOutlineName /\\v^\\s*\\S+/ contained containedin=CocOutlineLine', true)
    nvim.command('syntax match CocOutlineKind /\\[\\w\\+\\]/ contained containedin=CocOutlineLine', true)
    nvim.command('syntax match CocOutlineLine /\\d\\+$/ contained containedin=CocOutlineLine', true)
    nvim.command('highlight default link CocOutlineName Normal', true)
    nvim.command('highlight default link CocOutlineKind Typedef', true)
    nvim.command('highlight default link CocOutlineLine Comment', true)
    nvim.resumeNotification()
  }

  public async loadCtagsSymbols(document: Document): Promise<ListItem[]> {
    let uri = Uri.parse(document.uri)
    let extname = path.extname(uri.fsPath)
    let content: string
    let tempname = await this.nvim.call('tempname')
    let filepath = `${tempname}.${extname}`
    let escaped = await this.nvim.call('fnameescape', filepath)
    await writeFile(escaped, document.getDocumentContent())
    try {
      content = await runCommand(`ctags -f - --excmd=number --language-force=${document.filetype} ${escaped}`, process.cwd())
    } catch (e) {
      // noop
    }
    if (!content.trim().length) {
      content = await runCommand(`ctags -f - --excmd=number ${escaped}`, process.cwd())
    }
    content = content.trim()
    if (!content) return []
    let lines = content.split('\n')
    let items: ListItem[] = []
    for (let line of lines) {
      let parts = line.split('\t')
      let lnum = Number(parts[2].replace(/;"$/, ''))
      let text = document.getline(lnum - 1)
      if (!text) continue
      let idx = text.indexOf(parts[0])
      let start = idx == -1 ? 0 : idx
      let range: Range = Range.create(lnum - 1, start, lnum - 1, start + parts[0].length)
      items.push({
        label: `${parts[0]} [${parts[3]}] ${lnum}`,
        filterText: parts[0],
        location: Location.create(document.uri, range),
        data: { line: lnum }
      })
    }
    items.sort((a, b) => {
      return a.data.line - b.data.line
    })
    return items
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
  if (ra.start.line != rb.start.line) {
    return ra.start.line - rb.start.line
  }
  return ra.start.character - rb.start.character
}
