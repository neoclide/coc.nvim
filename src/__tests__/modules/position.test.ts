import { rangeInRange, positionInRange, comparePosition, isSingleLine, getChangedPosition, rangeOverlap } from '../../util/position'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'

function addPosition(position: Position, line: number, character: number): Position {
  return Position.create(position.line + line, position.character + character)
}

describe('Position', () => {
  test('rangeInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(rangeInRange(r, r)).toBe(true)
    expect(rangeInRange(r, Range.create(addPosition(pos, 1, 0), pos))).toBe(false)
  })

  test('rangeOverlap', () => {
    let r = Range.create(0, 0, 0, 0)
    expect(rangeOverlap(r, Range.create(0, 0, 0, 0))).toBe(false)
    expect(rangeOverlap(Range.create(0, 0, 0, 10), Range.create(0, 1, 0, 2))).toBe(true)
    expect(rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 1, 0, 2))).toBe(false)
    expect(rangeOverlap(Range.create(0, 1, 0, 2), Range.create(0, 0, 0, 1))).toBe(false)
    expect(rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 2, 0, 3))).toBe(false)
  })

  test('positionInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(positionInRange(pos, r)).toBe(0)
  })

  test('comparePosition', () => {
    let pos = Position.create(0, 0)
    expect(comparePosition(pos, pos)).toBe(0)
  })

  test('isSingleLine', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(isSingleLine(r)).toBe(true)
  })

  test('getChangedPosition #1', () => {
    let pos = Position.create(0, 0)
    let edit = TextEdit.insert(pos, 'abc')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 0, character: 3 })
  })

  test('getChangedPosition #2', () => {
    let pos = Position.create(0, 0)
    let edit = TextEdit.insert(pos, 'a\nb\nc')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 2, character: 1 })
  })

  test('getChangedPosition #3', () => {
    let pos = Position.create(0, 1)
    let r = Range.create(addPosition(pos, 0, -1), pos)
    let edit = TextEdit.replace(r, 'a\nb\n')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 2, character: -1 })
  })
})
