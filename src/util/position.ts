'use strict'
import { Position, Range } from 'vscode-languageserver-types'

export function rangeInRange(r: Range, range: Range): boolean {
  return positionInRange(r.start, range) === 0 && positionInRange(r.end, range) === 0
}

export function equalsRange(r: Range, range: Range): boolean {
  if (!samePosition(r.start, range.start)) return false
  return samePosition(r.end, range.end)
}

export function samePosition(one: Position, two: Position): boolean {
  return one.line === two.line && one.character === two.character
}

/**
 * A function that compares ranges, useful for sorting ranges
 * It will first compare ranges on the startPosition and then on the endPosition
 */
export function compareRangesUsingStarts(a: Range, b: Range): number {
  const aStartLineNumber = a.start.line | 0
  const bStartLineNumber = b.start.line | 0

  if (aStartLineNumber === bStartLineNumber) {
    const aStartColumn = a.start.character | 0
    const bStartColumn = b.start.character | 0

    if (aStartColumn === bStartColumn) {
      const aEndLineNumber = a.end.line | 0
      const bEndLineNumber = b.end.line | 0

      if (aEndLineNumber === bEndLineNumber) {
        const aEndColumn = a.end.character | 0
        const bEndColumn = b.end.character | 0
        return aEndColumn - bEndColumn
      }
      return aEndLineNumber - bEndLineNumber
    }
    return aStartColumn - bStartColumn
  }
  return aStartLineNumber - bStartLineNumber
}

/**
 * Convert to well formed range
 */
export function toValidRange(range: Range, max?: number): Range {
  let { start, end } = range
  if (start.line > end.line || (start.line === end.line && start.character > end.character)) {
    let m = start
    start = end
    end = m
  }
  start = Position.create(Math.max(0, start.line), Math.max(0, start.character))
  let endCharacter = Math.max(0, end.character)
  if (typeof max === 'number' && endCharacter > max) endCharacter = max
  end = Position.create(Math.max(0, end.line), endCharacter)
  return { start, end }
}

export function rangeAdjacent(r: Range, range: Range): boolean {
  if (comparePosition(r.end, range.start) == 0) {
    return true
  }
  if (comparePosition(range.end, r.start) == 0) {
    return true
  }
  return false
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

/**
 * Adjust from start position
 */
export function adjustRangePosition(range: Range, position: Position): Range {
  let { line, character } = position
  let { start, end } = range
  let endCharacter = end.line == start.line ? end.character + character : end.character
  return Range.create(start.line + line, character + start.character, end.line + line, endCharacter)
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

/*
 * Get end position by content
 */
export function getEnd(start: Position, content: string): Position {
  const lines = content.split(/\r?\n/)
  const len = lines.length
  const lastLine = lines[len - 1]
  const end = len == 1 ? start.character + content.length : lastLine.length
  return Position.create(start.line + len - 1, end)
}
