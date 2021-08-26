import { CompletionItemKind, TextEdit, Position } from 'vscode-languageserver-types'
import { getStartColumn, getKindString } from '../../sources/source-language'

describe('getKindString()', () => {
  it('should get kind text', async () => {
    let map = new Map()
    map.set(CompletionItemKind.Enum, 'E')
    let res = getKindString(CompletionItemKind.Enum, map, '')
    expect(res).toBe('E')
  })

  it('should get default value', async () => {
    let map = new Map()
    let res = getKindString(CompletionItemKind.Enum, map, 'D')
    expect(res).toBe('D')
  })
})

describe('getStartColumn()', () => {
  it('should get start col', async () => {
    expect(getStartColumn('', [{ label: 'foo' }])).toBe(null)
    expect(getStartColumn('', [
      { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 0), 'a') },
      { label: 'bar' }])).toBe(null)
    expect(getStartColumn('foo', [
      { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 0), 'a') },
      { label: 'bar', textEdit: TextEdit.insert(Position.create(0, 1), 'b') }])).toBe(null)
    expect(getStartColumn('foo', [
      { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 2), 'a') },
      { label: 'bar', textEdit: TextEdit.insert(Position.create(0, 2), 'b') }])).toBe(2)
  })
})
