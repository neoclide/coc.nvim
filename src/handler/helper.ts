import { DocumentSymbol, Range, MarkupContent, MarkupKind, SymbolInformation, Color } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { Documentation } from '../types'
import { wait } from '../util'
import { getSymbolKind } from '../util/convert'
import matchAll from 'string.prototype.matchall'
matchAll.shim()

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

export function getPreviousContainer(containerName: string, symbols: SymbolInfo[]): SymbolInfo {
  if (!symbols.length)
    return null
  let i = symbols.length - 1
  let last = symbols[i]
  if (last.text == containerName) {
    return last
  }
  while (i >= 0) {
    let sym = symbols[i]
    if (sym.text == containerName) {
      return sym
    }
    i--
  }
  return null
}

export function sortDocumentSymbols(a: DocumentSymbol, b: DocumentSymbol): number {
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

export function addDocument(docs: Documentation[], text: string, filetype: string, isPreview = false): void {
  let content = text.trim()
  if (!content.length)
    return
  if (isPreview && filetype !== 'markdown') {
    content = '``` ' + filetype + '\n' + content + '\n```'
  }
  docs.push({ content, filetype })
}

export async function synchronizeDocument(doc: Document): Promise<void> {
  let { changedtick } = doc
  await doc.patchChange()
  if (changedtick != doc.changedtick) {
    await wait(50)
  }
}

export function toHexString(color: Color): string {
  let c = toHexColor(color)
  return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`
}

function pad(str: string): string {
  return str.length == 1 ? `0${str}` : str
}

export function toHexColor(color: Color): { red: number; green: number; blue: number } {
  let { red, green, blue } = color
  return {
    red: Math.round(red * 255),
    green: Math.round(green * 255),
    blue: Math.round(blue * 255)
  }
}

export function isDark(color: Color): boolean {
  // http://www.w3.org/TR/WCAG20/#relativeluminancedef
  let rgb = [color.red, color.green, color.blue]
  let lum = []
  for (let i = 0; i < rgb.length; i++) {
    let chan = rgb[i]
    lum[i] = (chan <= 0.03928) ? chan / 12.92 : Math.pow(((chan + 0.055) / 1.055), 2.4)
  }
  let luma = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2]
  return luma <= 0.5
}
