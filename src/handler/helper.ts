import { DocumentSymbol, MarkupContent, MarkupKind, Range, SymbolInformation } from 'vscode-languageserver-protocol'
import { getSymbolKind } from '../util/convert'
import { comparePosition } from '../util/position'

export interface SymbolInfo {
  filepath?: string
  lnum: number
  col: number
  text: string
  kind: string
  level?: number
  containerName?: string
  range: Range
  selectionRange?: Range
}

export function sortDocumentSymbols(a: DocumentSymbol, b: DocumentSymbol): number {
  let ra = a.selectionRange
  let rb = b.selectionRange
  return comparePosition(ra.start, rb.start)
}

export function addDocumentSymbol(res: SymbolInfo[], sym: DocumentSymbol, level: number): void {
  let { name, selectionRange, kind, children, range } = sym
  let { start } = selectionRange
  res.push({
    col: start.character + 1,
    lnum: start.line + 1,
    text: name,
    level,
    kind: getSymbolKind(kind),
    range,
    selectionRange
  })
  if (children && children.length) {
    children.sort(sortDocumentSymbols)
    for (let sym of children) {
      addDocumentSymbol(res, sym, level + 1)
    }
  }
}

export function sortSymbolInformations(a: SymbolInformation, b: SymbolInformation): number {
  let sa = a.location.range.start
  let sb = b.location.range.start
  let d = sa.line - sb.line
  return d == 0 ? sa.character - sb.character : d

}

function isDocumentSymbol(a: DocumentSymbol | SymbolInformation): a is DocumentSymbol {
  return a && !a.hasOwnProperty('location')
}

export function isDocumentSymbols(a: DocumentSymbol[] | SymbolInformation[]): a is DocumentSymbol[] {
  return isDocumentSymbol(a[0])
}

export function isMarkdown(content: MarkupContent | string | undefined): boolean {
  if (MarkupContent.is(content) && content.kind == MarkupKind.Markdown) {
    return true
  }
  return false
}
