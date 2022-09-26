import { CancellationTokenSource, Range } from 'vscode-languageserver-protocol'
import { Chars } from '../../model/chars'
import { makeLine } from '../helper'

describe('chars keyword option', () => {
  it('should match @', () => {
    let chars = new Chars('@')
    expect(chars.isKeywordChar('a')).toBe(true)
    expect(chars.isKeywordChar('z')).toBe(true)
    expect(chars.isKeywordChar('A')).toBe(true)
    expect(chars.isKeywordChar('Z')).toBe(true)
    expect(chars.isKeywordChar('\u205f')).toBe(false)
  })

  it('should match code range', () => {
    let chars = new Chars('48-57')
    expect(chars.isKeywordChar('0')).toBe(true)
    expect(chars.isKeywordChar('9')).toBe(true)
  })

  it('should match @-@', () => {
    let chars = new Chars('@-@')
    expect(chars.isKeywordChar('@')).toBe(true)
  })

  it('should match single code', () => {
    let chars = new Chars('58')
    expect(chars.isKeywordChar(':')).toBe(true)
  })

  it('should match single character', () => {
    let chars = new Chars('_')
    expect(chars.isKeywordChar('_')).toBe(true)
  })
})

describe('chars addKeyword', () => {
  it('should add keyword', () => {
    let chars = new Chars('_')
    chars.addKeyword(':')
    expect(chars.isKeywordChar(':')).toBe(true)
    chars.addKeyword(':')
    expect(chars.isKeywordChar(':')).toBe(true)
  })
})

describe('chars computeWordRanges', () => {
  it('should computeWordRanges', async () => {
    let chars = new Chars('@')
    let res = await chars.computeWordRanges(['abc def hijkl'], Range.create(0, 4, 0, 7))
    expect(res).toEqual({
      def: [
        {
          start: {
            line: 0,
            character: 4
          },
          end: {
            line: 0,
            character: 7
          }
        }
      ]
    })
    res = await chars.computeWordRanges(['abc def ', 'foo def', ' ', ' abc'], Range.create(0, 3, 4, 0))
    expect(Object.keys(res)).toEqual(['def', 'foo', 'abc'])
    const r = (sl, sc, el, ec) => {
      return Range.create(sl, sc, el, ec)
    }
    expect(res['def']).toEqual([r(0, 4, 0, 7), r(1, 4, 1, 7)])
    expect(res['foo']).toEqual([r(1, 0, 1, 3)])
    expect(res['abc']).toEqual([r(3, 1, 3, 4)])
  })

  it('should wait after timeout', async () => {
    let l = makeLine(50)
    let arr: string[] = []
    for (let i = 0; i < 2000; i++) {
      arr.push(l)
    }
    let n = Date.now()
    let chars = new Chars('@')
    await chars.computeWordRanges(arr, Range.create(0, 0, 2000, 0))
    expect(Date.now() - n).toBeGreaterThan(30)
  })
})

describe('chars change keyword', () => {
  it('should change keyword', () => {
    let chars = new Chars('_')
    chars.setKeywordOption(':')
    expect(chars.isKeywordChar(String.fromCharCode(20))).toBe(false)
    expect(chars.isKeywordChar(':')).toBe(true)
    expect(chars.isKeywordChar('_')).toBe(false)
  })
})

describe('chars match keywords', () => {
  it('should match keywords', async () => {
    let chars = new Chars('@')
    let source = new CancellationTokenSource()
    let res = await chars.matchLines(['foo bar'], 3, source.token)
    expect(Array.from(res)).toEqual(['foo', 'bar'])
  })

  it('should consider unicode character as word', async () => {
    let chars = new Chars('@')
    let res = await chars.matchLines(['blackкофе'], 3)
    expect(Array.from(res)).toEqual(['blackкофе'])
  })
})

describe('chars isKeyword', () => {
  it('should check isKeyword', () => {
    let chars = new Chars('@')
    expect(chars.isKeyword('foo')).toBe(true)
    expect(chars.isKeyword('f@')).toBe(false)
  })
})
