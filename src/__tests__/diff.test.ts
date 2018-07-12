import {diffLines} from '../util/diff'

describe('should get diffLines', () => {
  it('should get diff for added', () => {
    let d = diffLines('1\n2', '1\n2\n3\n4')
    expect(d.start).toBe(1)
    expect(d.end).toBe(2)
    expect(d.replacement).toEqual(['2', '3', '4'])
  })

  it('should get diff for added #1', () => {
    let d = diffLines('1\n2\n3', '5\n1\n2\n3')
    expect(d.start).toBe(0)
    expect(d.end).toBe(0)
    expect(d.replacement).toEqual(['5'])
  })

  it('should get diff for added #2', () => {
    let d = diffLines('1\n2\n3', '1\n2\n4\n3')
    expect(d.start).toBe(2)
    expect(d.end).toBe(2)
    expect(d.replacement).toEqual(['4'])
  })

  it('should get diff for added #3', () => {
    let d = diffLines('1\n2\n3', '4\n1\n2\n3\n5')
    expect(d.start).toBe(0)
    expect(d.end).toBe(3)
    expect(d.replacement).toEqual(['4', '1', '2', '3', '5'])
  })

  it('should get diff for replace', () => {
    let d = diffLines('1\n2\n3\n4\n5', '1\n5\n3\n6\n7')
    expect(d.start).toBe(1)
    expect(d.end).toBe(5)
    expect(d.replacement).toEqual(['5', '3', '6', '7'])
  })

  it('should get diff for remove', () => {
    let d = diffLines('1\n2\n3\n4', '1\n4')
    expect(d.start).toBe(1)
    expect(d.end).toBe(3)
    expect(d.replacement).toEqual([])
  })
})
