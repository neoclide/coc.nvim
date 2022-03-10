import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'

export function rangeInRange(r: Range, range: Range): boolean {
  return positionInRange(r.start, range) === 0 && positionInRange(r.end, range) === 0
}

/**
 * Check if two ranges have overlap character.
 */
export function rangeOverlap(r: Range, range: Range): boolean {
  let { start, end } = r
  if (comparePosition(end, range.start) <= 0) {
    return false
  }
  if (comparePosition(start, range.end) >= 0) {
    return false
  }
  return true
}

/**
 * Check if two ranges have overlap or nested
 */
export function rangeIntersect(r: Range, range: Range): boolean {
  if (positionInRange(r.start, range) == 0) {
    return true
  }
  if (positionInRange(r.end, range) == 0) {
    return true
  }
  if (rangeInRange(range, r)) {
    return true
  }
  return false
}

export function lineInRange(line: number, range: Range): boolean {
  let { start, end } = range
  return line >= start.line && line <= end.line
}

export function emptyRange(range: Range): boolean {
  let { start, end } = range
  return start.line == end.line && start.character == end.character
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

export function getChangedPosition(start: Position, edit: TextEdit): { line: number; character: number } {
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

export function getChangedFromEdits(start: Position, edits: TextEdit[]): Position | null {
  let changed = { line: 0, character: 0 }
  for (let edit of edits) {
    let d = getChangedPosition(start, edit)
    changed = { line: changed.line + d.line, character: changed.character + d.character }
  }
  return changed.line == 0 && changed.character == 0 ? null : changed
}
