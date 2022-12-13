import { CancellationTokenSource, Range } from 'vscode-languageserver-protocol'
import { Chars, IntegerRanges, getCharCode, splitKeywordOption, sameScope, chineseSegments } from '../../model/chars'
import { makeLine } from '../helper'

describe('funcs', () => {
  it('should splitKeywordsOptions', () => {
    expect(splitKeywordOption('')).toEqual([])
    expect(splitKeywordOption('_,-,128-140,#-43')).toEqual(['_', '-', '128-140', '#-43'])
    expect(splitKeywordOption('^a-z,#,^')).toEqual(['^a-z', '#', '^'])
    expect(splitKeywordOption('@,^a-z')).toEqual(['@', '^a-z'])
    expect(splitKeywordOption('48-57,,,_')).toEqual(['48-57', ',', '_'])
    expect(splitKeywordOption(' -~,^,,9')).toEqual([' -~', '^,', '9'])
    expect(splitKeywordOption(' -~,^,')).toEqual([' -~', '^,'])
  })

  it('should toCharCode', () => {
    expect(getCharCode('10')).toBe(10)
    expect(getCharCode('')).toBeUndefined()
    expect(getCharCode('a')).toBe(97)
  })

  it('should sameScope', () => {
    expect(sameScope(1, 3)).toBe(true)
    expect(sameScope(266, 1024)).toBe(true)
    expect(sameScope(97, 19970)).toBe(false)
  })

  it('should chineseSegments', () => {
    let res = Array.from(chineseSegments('你好世界'))
    expect(Array.isArray(res)).toBe(true)
    let fn = Intl['Segmenter']
    if (typeof fn === 'function') {
      Object.defineProperty(Intl, 'Segmenter', {
        get: () => {
          return undefined
        }
      })
      res = Array.from(chineseSegments('你好世界'))
      Object.defineProperty(Intl, 'Segmenter', {
        get: () => {
          return fn
        }
      })
      expect(res).toEqual(['你好世界'])
    }
  })
})

describe('IntegerRanges', () => {
  it('should add ranges', () => {
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

  it('should exclude ranges', () => {
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

  it('should check word code', () => {
    let r = new IntegerRanges([], true)
    expect(r.includes(258)).toBe(true)
    expect(r.includes(894)).toBe(false)
    expect(r.includes(33)).toBe(false)
  })

  it('should fromKeywordOption', () => {
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

describe('chars', () => {
  describe('isKeywordChar()', () => {
    it('should match @', () => {
      let chars = new Chars('@')
      expect(chars.isKeywordChar('a')).toBe(true)
      expect(chars.isKeywordChar('z')).toBe(true)
      expect(chars.isKeywordChar('A')).toBe(true)
      expect(chars.isKeywordChar('Z')).toBe(true)
      expect(chars.isKeywordChar('\u205f')).toBe(false)
    })

    it('should iterateWords', async () => {
      let chars = new Chars('@')
      let res = Array.from(chars.iterateWords(' 你好foo bar'))
      expect(res).toEqual([[1, 3], [3, 6], [7, 10]])
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

  describe('addKeyword()', () => {
    it('should add keyword', () => {
      let chars = new Chars('_')
      chars.addKeyword(':')
      expect(chars.isKeywordChar(':')).toBe(true)
      chars.addKeyword(':')
      expect(chars.isKeywordChar(':')).toBe(true)
    })
  })

  describe('computeWordRanges()', () => {
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

  describe('matchLine()', () => {
    it('should matchLine', async () => {
      let text = 'a'.repeat(2048)
      let chars = new Chars('@')
      expect(chars.matchLine(text, 3, 128)).toEqual(['a'.repeat(128)])
      expect(chars.matchLine('a b c')).toEqual([])
      expect(chars.matchLine('foo bar')).toEqual(['foo', 'bar'])
      expect(chars.matchLine('?foo bar')).toEqual(['foo', 'bar'])
      expect(chars.matchLine('?foo $')).toEqual(['foo'])
      expect(chars.matchLine('?foo foo foo')).toEqual(['foo'])
      expect(chars.matchLine(' 你好foo')).toEqual(['你好', 'foo'])
      expect(chars.matchLine('bar你好')).toEqual(['bar', '你好'])
      expect(chars.matchLine('你好，世界。')).toEqual(['你好', '世界'])
      expect(chars.matchLine('foo😍bar foo，bar')).toEqual(['foo', 'bar'])
    })
  })

  describe('iskeyword()', () => {
    it('should check isKeyword', () => {
      let chars = new Chars('@')
      expect(chars.isKeyword('foo')).toBe(true)
      expect(chars.isKeyword('f@')).toBe(false)
    })
  })
})
