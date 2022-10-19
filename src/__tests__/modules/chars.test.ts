import { CancellationTokenSource, Range } from 'vscode-languageserver-protocol'
import { Chars, IntegerRanges, getCharCode, splitKeywordOption } from '../../model/chars'
import { makeLine } from '../helper'

describe('funcs', () => {
  it('should splitKeywordsOptions', async () => {
    expect(splitKeywordOption('')).toEqual([])
    expect(splitKeywordOption('_,-,128-140,#-43')).toEqual(['_', '-', '128-140', '#-43'])
    expect(splitKeywordOption('^a-z,#,^')).toEqual(['^a-z', '#', '^'])
    expect(splitKeywordOption('@,^a-z')).toEqual(['@', '^a-z'])
    expect(splitKeywordOption('48-57,,,_')).toEqual(['48-57', ',', '_'])
    expect(splitKeywordOption(' -~,^,,9')).toEqual([' -~', '^,', '9'])
    expect(splitKeywordOption(' -~,^,')).toEqual([' -~', '^,'])
  })

  it('should toCharCode', async () => {
    expect(getCharCode('10')).toBe(10)
    expect(getCharCode('')).toBeUndefined()
    expect(getCharCode('a')).toBe(97)
  })
})

describe('IntegerRanges', () => {
  it('should add ranges', async () => {
    let r = new IntegerRanges()
    expect(r.flatten()).toEqual([])
    r.add(4, 3)
    r.add(1)
    r.add(2)
    expect(r.flatten()).toEqual([1, 1, 2, 2, 3, 4])
    r.add(2, 7)
    expect(r.flatten()).toEqual([1, 1, 2, 7])
    r.add(7, 9)
    expect(r.flatten()).toEqual([1, 1, 2, 9])
    r.add(2, 5)
    expect(r.flatten()).toEqual([1, 1, 2, 9])
  })

  it('should exclude ranges', async () => {
    let r = new IntegerRanges()
    r.add(1, 2)
    r.add(4, 6)
    r.exclude(3, 3)
    r.exclude(8)
    r.exclude(9, 10)
    expect(r.flatten()).toEqual([1, 2, 4, 6])
    r.exclude(4, 6)
    r.exclude(1, 2)
    expect(r.flatten()).toEqual([])
    r.add(3, 8)
    r.exclude(1, 3)
    r.exclude(8, 9)
    expect(r.flatten()).toEqual([4, 7])
    r.exclude(6, 5)
    expect(r.flatten()).toEqual([4, 4, 7, 7])
    expect(r.includes(4)).toBe(true)
    expect(r.includes(7)).toBe(true)
  })

  it('should check word code', async () => {
    let r = new IntegerRanges([], true)
    expect(r.includes(258)).toBe(true)
    expect(r.includes(894)).toBe(false)
    expect(r.includes(33)).toBe(false)
  })

  it('should fromKeywordOption', async () => {
    let r = IntegerRanges.fromKeywordOption('@,_')
    expect(r.includes(97)).toBe(true)
    expect(r.includes('_'.charCodeAt(0))).toBe(true)
    r = IntegerRanges.fromKeywordOption('@-@,9,^')
    expect(r.includes(9)).toBe(true)
    expect(r.includes('@'.charCodeAt(0))).toBe(true)
    expect(r.includes('^'.charCodeAt(0))).toBe(true)
    r = IntegerRanges.fromKeywordOption('@,^a-z')
    expect(r.includes(97)).toBe(false)
    r = IntegerRanges.fromKeywordOption('48-57,,,_')
    expect(r.includes(48)).toBe(true)
    expect(r.includes(','.charCodeAt(0))).toBe(true)
    expect(r.includes('_'.charCodeAt(0))).toBe(true)
    r = IntegerRanges.fromKeywordOption('_,-,128-140,#-43')
    expect(r.includes(130)).toBe(true)
    expect(r.includes(43)).toBe(true)
    expect(r.includes('_'.charCodeAt(0))).toBe(true)
    expect(r.includes('-'.charCodeAt(0))).toBe(true)
    expect(r.includes('#'.charCodeAt(0))).toBe(true)
    r = IntegerRanges.fromKeywordOption(' -~,^,,9')
    expect(r.includes(' '.charCodeAt(0))).toBe(true)
    expect(r.includes(','.charCodeAt(0))).toBe(false)
    expect(r.includes(9)).toBe(true)
    r = IntegerRanges.fromKeywordOption('65,-x,x-')
    expect(r.includes(65)).toBe(true)
    r = IntegerRanges.fromKeywordOption('128-140,-')
    expect(r.includes('-'.charCodeAt(0))).toBe(true)
  })
})

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
    let l = makeLine(200)
    let arr: string[] = []
    for (let i = 0; i < 8000; i++) {
      arr.push(l)
    }
    let chars = new Chars('@')
    let tokenSource = new CancellationTokenSource()
    let timer = setTimeout(() => {
      tokenSource.cancel()
    }, 30)
    await chars.computeWordRanges(arr, Range.create(0, 0, 8000, 0), tokenSource.token)
    clearTimeout(timer)
    expect(tokenSource.token.isCancellationRequested).toBe(true)
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
