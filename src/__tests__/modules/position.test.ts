import { rangeInRange, positionInRange, comparePosition, isSingleLine, getChangedPosition } from '../../util/position'
import { Position, Range, TextEdit } from 'vscode-languageserver-types'

function addPosition(position: Position, line: number, character: number): Position {
  return Position.create(position.line + line, position.character + character)
}

describe('Position', () => {
  test('rangeInRange', async () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(rangeInRange(r, r)).toBe(true)
    expect(rangeInRange(r, Range.create(addPosition(pos, 1, 0), pos))).toBe(false)
  })

  test('positionInRange', async () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(positionInRange(pos, r)).toBe(0)
  })

  test('comparePosition', async () => {
    let pos = Position.create(0, 0)
    expect(comparePosition(pos, pos)).toBe(0)
  })

  test('isSingleLine', async () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(isSingleLine(r)).toBe(true)
  })

  test('getChangedPosition #1', async () => {
    let pos = Position.create(0, 0)
    let edit = TextEdit.insert(pos, 'abc')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 0, character: 3 })
  })

  test('getChangedPosition #2', async () => {
    let pos = Position.create(0, 0)
    let edit = TextEdit.insert(pos, 'a\nb\nc')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 2, character: 1 })
  })

  test('getChangedPosition #3', async () => {
    let pos = Position.create(0, 1)
    let r = Range.create(addPosition(pos, 0, -1), pos)
    let edit = TextEdit.replace(r, 'a\nb\n')
    let res = getChangedPosition(pos, edit)
    expect(res).toEqual({ line: 2, character: -1 })
  })
})
