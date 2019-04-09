import { getChange, patchLine, diffLines } from '../../util/diff'
import { TextDocument, TextEdit } from 'vscode-languageserver-types'

describe('diff lines', () => {
  it('should diff changed lines', () => {
    let res = diffLines('a\n', 'b\n')
    expect(res).toEqual({ start: 0, end: 1, replacement: ['b'] })
  })

  it('should diff added lines', () => {
    let res = diffLines('a\n', 'a\nb\n')
    expect(res).toEqual({
      start: 1,
      end: 1,
      replacement: ['b']
    })
  })

  it('should diff remove lines', () => {
    let res = diffLines('a\n\n', 'a\n')
    expect(res).toEqual({
      start: 2,
      end: 3,
      replacement: []
    })
  })

  it('should diff remove multiple lines', () => {
    let res = diffLines('a\n\n\n', 'a\n')
    expect(res).toEqual({
      start: 2,
      end: 4,
      replacement: []
    })
  })
})

describe('patch line', () => {
  it('should patch line', () => {
    let res = patchLine('foo', 'bar foo bar')
    expect(res.length).toBe(7)
    expect(res).toBe('    foo')
  })
})

describe('should get text edits', () => {

  function applyEdits(oldStr: string, newStr: string): void {
    let doc = TextDocument.create('untitled://1', 'markdown', 0, oldStr)
    let change = getChange(doc.getText(), newStr)
    let start = doc.positionAt(change.start)
    let end = doc.positionAt(change.end)
    let edit: TextEdit = {
      range: { start, end },
      newText: change.newText
    }
    let res = TextDocument.applyEdits(doc, [edit])
    expect(res).toBe(newStr)
  }

  it('should return null for same content', () => {
    let change = getChange('', '')
    expect(change).toBeNull()
    change = getChange('abc', 'abc')
    expect(change).toBeNull()
  })

  it('should get diff for added', () => {
    applyEdits('1\n2', '1\n2\n3\n4')
  })

  it('should get diff for added #0', () => {
    applyEdits('\n\n', '\n\n\n')
  })

  it('should get diff for added #1', () => {
    applyEdits('1\n2\n3', '5\n1\n2\n3')
  })

  it('should get diff for added #2', () => {
    applyEdits('1\n2\n3', '1\n2\n4\n3')
  })

  it('should get diff for added #3', () => {
    applyEdits('1\n2\n3', '4\n1\n2\n3\n5')
  })

  it('should get diff for added #4', () => {
    applyEdits(' ', '   ')
  })

  it('should get diff for replace', () => {
    applyEdits('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
  })

  it('should get diff for replace #1', () => {
    applyEdits('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
  })

  it('should get diff for remove #0', () => {
    applyEdits('1\n2\n3\n4', '1\n4')
  })

  it('should get diff for remove #1', () => {
    applyEdits('1\n2\n3\n4', '1')
  })

  it('should get diff for remove #2', () => {
    applyEdits('  ', ' ')
  })
})
