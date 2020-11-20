import { Range, Position, TextEdit } from 'vscode-languageserver-protocol'
import Document from '../model/document'

/**
 * Split to single line ranges
 */
export function splitRange(doc: Document, range: Range): Range[] {
  let splited: Range[] = []
  for (let i = range.start.line; i <= range.end.line; i++) {
    let curr = doc.getline(i) || ''
    let sc = i == range.start.line ? range.start.character : 0
    let ec = i == range.end.line ? range.end.character : curr.length
    if (sc == ec) continue
    splited.push(Range.create(i, sc, i, ec))
  }
  return splited
}

/**
 * Get ranges of visual block
 */
export function getVisualRanges(doc: Document, range: Range): Range[] {
  let { start, end } = range
  if (start.line > end.line) {
    [start, end] = [end, start]
  }
  let sc = start.character < end.character ? start.character : end.character
  let ec = start.character < end.character ? end.character : start.character
  let ranges: Range[] = []
  for (let i = start.line; i <= end.line; i++) {
    let line = doc.getline(i)
    ranges.push(Range.create(i, sc, i, Math.min(line.length, ec)))
  }
  return ranges
}

export function adjustPosition(position: Position, delta: Position): Position {
  let { line, character } = delta
  return Position.create(position.line + line, line == 0 ? position.character + character : character)
}

export function equalEdit(one: TextEdit, two: TextEdit): boolean {
  if (one.newText.length != two.newText.length) return false
  let { range } = one
  if (range.end.character - range.start.character != two.range.end.character - two.range.start.character) {
    return false
  }
  return true
}
