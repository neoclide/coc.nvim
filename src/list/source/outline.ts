'use strict'
import { Neovim } from '@chemzqm/neovim'
import { DocumentSymbol, Location, Range, SymbolInformation } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../../languages'
import Document from '../../model/document'
import { isFalsyOrEmpty } from '../../util/array'
import { getSymbolKind } from '../../util/convert'
import { writeFile } from '../../util/fs'
import { path, which } from '../../util/node'
import { compareRangesUsingStarts } from '../../util/position'
import { runCommand } from '../../util/processes'
import type { CancellationToken } from '../../util/protocol'
import workspace from '../../workspace'
import { formatListItems, UnformattedListItem } from '../formatting'
import { ListArgument, ListContext, ListItem } from '../types'
import LocationList from './location'

export default class Outline extends LocationList {
  public readonly description = 'symbols of current document'
  public name = 'outline'
  public options: ListArgument[] = [{
    name: '-k, -kind KIND',
    hasValue: true,
    description: 'filter symbol by kind',
  }]

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    let document = workspace.getAttachedDocument(context.buffer.id)
    let config = this.getConfig()
    let ctagsFiletypes = config.get<string[]>('ctagsFiletypes', [])
    let symbols: DocumentSymbol[] | null
    let args = this.parseArguments(context.args)
    let filterKind = args.kind ? args.kind.toString().toLowerCase() : null
    if (!ctagsFiletypes.includes(document.filetype)) {
      symbols = await languages.getDocumentSymbol(document.textDocument, token)
    }
    if (token.isCancellationRequested) return []
    if (!symbols) return await loadCtagsSymbols(document, this.nvim, token)
    if (isFalsyOrEmpty(symbols)) return []
    let items = symbolsToListItems(symbols, document.uri, filterKind)
    return formatListItems(this.alignColumns, items)
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocOutlineName /\\v\\s?[^\\t]+\\s/ contained containedin=CocOutlineLine', true)
    nvim.command('syntax match CocOutlineIndentLine /\\v\\|/ contained containedin=CocOutlineLine,CocOutlineName', true)
    nvim.command('syntax match CocOutlineKind /\\[\\w\\+\\]/ contained containedin=CocOutlineLine', true)
    nvim.command('syntax match CocOutlineLine /\\d\\+$/ contained containedin=CocOutlineLine', true)
    nvim.command('highlight default link CocOutlineName Normal', true)
    nvim.command('highlight default link CocOutlineIndentLine Comment', true)
    nvim.command('highlight default link CocOutlineKind Typedef', true)
    nvim.command('highlight default link CocOutlineLine Comment', true)
    nvim.resumeNotification(false, true)
  }
}

export function symbolsToListItems(symbols: DocumentSymbol[], uri: string, filterKind: string | null): UnformattedListItem[] {
  let items: UnformattedListItem[] = []
  const addSymbols = (symbols: DocumentSymbol[], level = 0) => {
    symbols.sort((a, b) => {
      return compareRangesUsingStarts(a.selectionRange, b.selectionRange)
    })
    for (let s of symbols) {
      let kind = getSymbolKind(s.kind)
      let location = Location.create(uri, s.selectionRange)
      items.push({
        label: [`${'| '.repeat(level)}${s.name}`, `[${kind}]`, `${s.range.start.line + 1}`],
        filterText: getFilterText(s, filterKind),
        location,
        data: { kind }
      })
      if (!isFalsyOrEmpty(s.children)) {
        addSymbols(s.children, level + 1)
      }
    }
  }
  addSymbols(symbols as DocumentSymbol[])
  if (filterKind) {
    items = items.filter(o => o.data.kind.toLowerCase().indexOf(filterKind) == 0)
  }
  return items
}

export function getFilterText(s: DocumentSymbol | SymbolInformation, kind: string | null): string {
  if (typeof kind === 'string' && kind.length > 0) return s.name
  return `${s.name}${getSymbolKind(s.kind)}`
}

export async function loadCtagsSymbols(document: Document, nvim: Neovim, token: CancellationToken): Promise<ListItem[]> {
  if (!which.sync('ctags', { nothrow: true })) {
    return []
  }
  let uri = URI.parse(document.uri)
  let extname = path.extname(uri.fsPath)
  let content = ''
  let tempname = await nvim.call('tempname') as string
  let filepath = `${tempname}.${extname}`
  let cwd = path.dirname(tempname)
  let escaped = await nvim.call('fnameescape', filepath) as string
  await writeFile(escaped, document.getDocumentContent())
  try {
    content = await runCommand(`ctags -f - --excmd=number --language-force=${document.filetype} ${escaped}`, { cwd }, token)
  } catch (e) {
    // noop
  }
  if (!content.trim().length) {
    content = await runCommand(`ctags -f - --excmd=number ${escaped}`, { cwd }, token)
  }
  content = content.trim()
  if (!content) return []
  return contentToItems(content, document)
}

export function contentToItems(content: string, document: Document): ListItem[] {
  let lines = content.split(/\r?\n/)
  let items: ListItem[] = []
  for (let line of lines) {
    let parts = line.split('\t')
    if (parts.length < 4) continue
    let lnum = Number(parts[2].replace(/;"$/, ''))
    let text = document.getline(lnum - 1)
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
  items.sort((a, b) => a.data.line - b.data.line)
  return items
}
