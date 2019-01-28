import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'

export function rangeInRange(r: Range, range: Range): boolean {
  return positionInRange(r.start, range) === 0 && positionInRange(r.end, range) === 0
}

export function positionInRange(position: Position, range: Range): number {
  let { start, end } = range
  if (comparePosition(position, start) < 0) return -1
  if (comparePosition(position, end) > 0) return 1
  return 0
}

export function comparePosition(position: Position, other: Position): number {
  if (position.line > other.line) return 1
  if (other.line == position.line && position.character > other.character) return 1
  if (other.line == position.line && position.character == other.character) return 0
  return -1
}

export function isSingleLine(range: Range): boolean {
  return range.start.line == range.end.line
}

export function getChangedPosition(start: Position, edit: TextEdit): { line: number, character: number } {
  let { range, newText } = edit
  if (comparePosition(range.end, start) <= 0) {
    let lines = newText.split('\n')
    let lineCount = lines.length - (range.end.line - range.start.line) - 1
    let characterCount = 0
    if (range.end.line == start.line) {
      let single = isSingleLine(range) && lineCount == 0
      let removed = single ? range.end.character - range.start.character : range.end.character
      let added = single ? newText.length : lines[lines.length - 1].length
      characterCount = added - removed
    }
    return { line: lineCount, character: characterCount }
  }
  return { line: 0, character: 0 }
}
