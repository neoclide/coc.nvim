import { getContentChanges } from '../../util/diff'
import { TextDocument } from 'vscode-languageserver-types'

describe('should get text edits', () => {

  function applyEdits(oldStr: string, newStr: string): void {
    let doc = TextDocument.create('untitled://1', 'markdown', 0, oldStr)
    let changes = getContentChanges(doc, newStr)
    let res = TextDocument.applyEdits(doc, changes.map(o => {
      return { range: o.range, newText: o.text }
    }))
    expect(res).toBe(newStr)
  }

  it('should get diff for added', () => {
    applyEdits('1\n2', '1\n2\n3\n4')
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

  it('should get diff for replace', () => {
    applyEdits('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
  })

  it('should get diff for replace #1', () => {
    applyEdits('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
  })

  it('should get diff for remove', () => {
    applyEdits('1\n2\n3\n4', '1\n4')
  })

  it('should get diff for remove #1', () => {
    applyEdits('1\n2\n3\n4', '1')
  })
})
