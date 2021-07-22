import { DocumentSymbol, Range, SymbolInformation } from 'vscode-languageserver-protocol'
import { getSymbolKind } from '../../util/convert'
import { comparePosition } from '../../util/position'

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

export function convertSymbols(symbols: DocumentSymbol[]): SymbolInfo[] {
  let res: SymbolInfo[] = []
  let arr = symbols.slice()
  arr.sort(sortDocumentSymbols)
  arr.forEach(s => addDocumentSymbol(res, s, 0))
  return res
}

export function sortDocumentSymbols(a: DocumentSymbol, b: DocumentSymbol): number {
  let ra = a.selectionRange
  let rb = b.selectionRange
  return comparePosition(ra.start, rb.start)
}

export function addDocumentSymbol(res: SymbolInfo[], sym: DocumentSymbol, level: number): void {
  let { name, selectionRange, kind, children, range } = sym
  let { start } = selectionRange || range
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

function isDocumentSymbol(a: DocumentSymbol | SymbolInformation): a is DocumentSymbol {
  return a && !a.hasOwnProperty('location')
}

export function isDocumentSymbols(a: DocumentSymbol[] | SymbolInformation[]): a is DocumentSymbol[] {
  return isDocumentSymbol(a[0])
}
