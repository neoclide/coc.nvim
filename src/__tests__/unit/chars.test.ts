import { CancellationTokenSource, Range } from 'vscode-languageserver-protocol'
import { Chars, IntegerRanges, detectLanguage, getCharCode, parseSegments, sameScope, splitKeywordOption } from '../../model/chars'
import { makeLine } from './testUtils'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

describe('funcs', () => {
  it('should splitKeywordsOptions', () => {
    assert.deepStrictEqual(splitKeywordOption(''), [])
    assert.deepStrictEqual(splitKeywordOption('_,-,128-140,#-43'), ['_', '-', '128-140', '#-43'])
    assert.deepStrictEqual(splitKeywordOption('^a-z,#,^'), ['^a-z', '#', '^'])
    assert.deepStrictEqual(splitKeywordOption('@,^a-z'), ['@', '^a-z'])
    assert.deepStrictEqual(splitKeywordOption('48-57,,,_'), ['48-57', ',', '_'])
    assert.deepStrictEqual(splitKeywordOption(' -~,^,,9'), [' -~', '^,', '9'])
    assert.deepStrictEqual(splitKeywordOption(' -~,^,'), [' -~', '^,'])
  })

  it('should toCharCode', () => {
    assert.strictEqual(getCharCode('10'), 10)
    assert.strictEqual(getCharCode(''), undefined)
    assert.strictEqual(getCharCode('a'), 97)
  })

  it('should sameScope', () => {
    assert.strictEqual(sameScope(1, 3), true)
    assert.strictEqual(sameScope(266, 1024), true)
    assert.strictEqual(sameScope(97, 19970), false)
  })

  it('should use Segmenter', () => {
    let res = Array.from(parseSegments('你好世界', 'cn'))
    assert.strictEqual(Array.isArray(res), true)
    let fn = Intl['Segmenter']
    if (typeof fn === 'function') {
      Object.defineProperty(Intl, 'Segmenter', {
        get: () => {
          return undefined
        }
      })
      res = Array.from(parseSegments('你好世界', 'cn'))
      Object.defineProperty(Intl, 'Segmenter', {
        get: () => {
          return fn
        }
      })
      assert.deepStrictEqual(res, ['你好世界'])
      res = Array.from(parseSegments('你好世界', ''))
      assert.notStrictEqual(res, undefined)
    }
  })

  it('should reuse cached segmenter per locale', () => {
    let fn = Intl['Segmenter']
    if (typeof fn !== 'function') return
    // Intl.Segmenter is an accessor property, which t.mock.method cannot
    // spy on (it reads the descriptor value). Mock the getter manually.
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!
    let calls = 0
    Object.defineProperty(Intl, 'Segmenter', {
      configurable: true,
      get: () => function (this: unknown, locales?: Intl.LocalesArgument, options?: Intl.SegmenterOptions) {
        calls++
        return Reflect.construct(fn, [locales, options])
      }
    })
    try {
      let locale = 'zh-x-coc-cache-test'
      assert.deepStrictEqual(Array.from(parseSegments('你好世界', locale)), ['你好', '世界'])
      assert.strictEqual(calls, 1)
      assert.deepStrictEqual(Array.from(parseSegments('你好世界', locale)), ['你好', '世界'])
      assert.strictEqual(calls, 1)
      assert.deepStrictEqual(Array.from(parseSegments('你好世界', 'zh-x-coc-cache-other')), ['你好', '世界'])
      assert.strictEqual(calls, 2)
    } finally {
      Object.defineProperty(Intl, 'Segmenter', descriptor)
    }
  })

  it('should delete language', () => {
    assert.strictEqual(detectLanguage('你'.charCodeAt(0)), 'cn')
    assert.strictEqual(detectLanguage('れ'.charCodeAt(0)), 'ja')
    assert.strictEqual(detectLanguage('것'.charCodeAt(0)), 'ko')
    assert.strictEqual(detectLanguage(0xFFFF), '')
  })
})

describe('IntegerRanges', () => {
  it('should add ranges', () => {
    let r = new IntegerRanges()
    assert.deepStrictEqual(r.flatten(), [])
    r.add(4, 3)
    r.add(1)
    r.add(2)
    assert.deepStrictEqual(r.flatten(), [1, 1, 2, 2, 3, 4])
    r.add(2, 7)
    assert.deepStrictEqual(r.flatten(), [1, 1, 2, 7])
    r.add(7, 9)
    assert.deepStrictEqual(r.flatten(), [1, 1, 2, 9])
    r.add(2, 5)
    assert.deepStrictEqual(r.flatten(), [1, 1, 2, 9])
  })

  it('should exclude ranges', () => {
    let r = new IntegerRanges()
    r.add(1, 2)
    r.add(4, 6)
    r.exclude(3, 3)
    r.exclude(8)
    r.exclude(9, 10)
    assert.deepStrictEqual(r.flatten(), [1, 2, 4, 6])
    r.exclude(4, 6)
    r.exclude(1, 2)
    assert.deepStrictEqual(r.flatten(), [])
    r.add(3, 8)
    r.exclude(1, 3)
    r.exclude(8, 9)
    assert.deepStrictEqual(r.flatten(), [4, 7])
    r.exclude(6, 5)
    assert.deepStrictEqual(r.flatten(), [4, 4, 7, 7])
    assert.strictEqual(r.includes(4), true)
    assert.strictEqual(r.includes(7), true)
  })

  it('should check word code', () => {
    let r = new IntegerRanges([], true)
    assert.strictEqual(r.includes(258), true)
    assert.strictEqual(r.includes(894), false)
    assert.strictEqual(r.includes(33), false)
  })

  it('should fromKeywordOption', () => {
    let r = IntegerRanges.fromKeywordOption('@,_')
    assert.strictEqual(r.includes(97), true)
    assert.strictEqual(r.includes('_'.charCodeAt(0)), true)
    r = IntegerRanges.fromKeywordOption('@-@,9,^')
    assert.strictEqual(r.includes(9), true)
    assert.strictEqual(r.includes('@'.charCodeAt(0)), true)
    assert.strictEqual(r.includes('^'.charCodeAt(0)), true)
    r = IntegerRanges.fromKeywordOption('@,^a-z')
    assert.strictEqual(r.includes(97), false)
    r = IntegerRanges.fromKeywordOption('48-57,,,_')
    assert.strictEqual(r.includes(48), true)
    assert.strictEqual(r.includes(','.charCodeAt(0)), true)
    assert.strictEqual(r.includes('_'.charCodeAt(0)), true)
    r = IntegerRanges.fromKeywordOption('_,-,128-140,#-43')
    assert.strictEqual(r.includes(130), true)
    assert.strictEqual(r.includes(43), true)
    assert.strictEqual(r.includes('_'.charCodeAt(0)), true)
    assert.strictEqual(r.includes('-'.charCodeAt(0)), true)
    assert.strictEqual(r.includes('#'.charCodeAt(0)), true)
    r = IntegerRanges.fromKeywordOption(' -~,^,,9')
    assert.strictEqual(r.includes(' '.charCodeAt(0)), true)
    assert.strictEqual(r.includes(','.charCodeAt(0)), false)
    assert.strictEqual(r.includes(9), true)
    r = IntegerRanges.fromKeywordOption('65,-x,x-')
    assert.strictEqual(r.includes(65), true)
    r = IntegerRanges.fromKeywordOption('128-140,-')
    assert.strictEqual(r.includes('-'.charCodeAt(0)), true)
  })
})

describe('chars', () => {
  describe('isKeywordChar()', () => {
    it('should match @', () => {
      let chars = new Chars('@')
      assert.strictEqual(chars.isKeywordChar('a'), true)
      assert.strictEqual(chars.isKeywordChar('z'), true)
      assert.strictEqual(chars.isKeywordChar('A'), true)
      assert.strictEqual(chars.isKeywordChar('Z'), true)
      assert.strictEqual(chars.isKeywordChar('\u205f'), false)
    })

    it('should iterateWords', async () => {
      let chars = new Chars('@')
      let res = Array.from(chars.iterateWords(' 你好foo bar'))
      assert.deepStrictEqual(res, [[1, 3], [3, 6], [7, 10]])
    })

    it('should match code range', () => {
      let chars = new Chars('48-57')
      assert.strictEqual(chars.isKeywordChar('0'), true)
      assert.strictEqual(chars.isKeywordChar('9'), true)
    })

    it('should match @-@', () => {
      let chars = new Chars('@-@')
      assert.strictEqual(chars.isKeywordChar('@'), true)
    })

    it('should match single code', () => {
      let chars = new Chars('58')
      assert.strictEqual(chars.isKeywordChar(':'), true)
    })

    it('should match single character', () => {
      let chars = new Chars('_')
      assert.strictEqual(chars.isKeywordChar('_'), true)
    })
  })

  describe('addKeyword()', () => {
    it('should add keyword', () => {
      let chars = new Chars('_')
      chars.addKeyword(':')
      assert.strictEqual(chars.isKeywordChar(':'), true)
      chars.addKeyword(':')
      assert.strictEqual(chars.isKeywordChar(':'), true)
    })
  })

  describe('computeWordRanges()', () => {
    it('should computeWordRanges', async () => {
      let chars = new Chars('@')
      let res = await chars.computeWordRanges(['abc def hijkl'], Range.create(0, 4, 0, 7))
      assert.deepStrictEqual(res, {
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
      assert.deepStrictEqual(Object.keys(res), ['def', 'foo', 'abc'])
      const r = (sl, sc, el, ec) => {
        return Range.create(sl, sc, el, ec)
      }
      assert.deepStrictEqual(res['def'], [r(0, 4, 0, 7), r(1, 4, 1, 7)])
      assert.deepStrictEqual(res['foo'], [r(1, 0, 1, 3)])
      assert.deepStrictEqual(res['abc'], [r(3, 1, 3, 4)])
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
      assert.strictEqual(tokenSource.token.isCancellationRequested, true)
    })
  })

  describe('matchLine()', () => {
    it('should matchLine', async () => {
      let text = 'a'.repeat(2048)
      let chars = new Chars('@')
      assert.deepStrictEqual(chars.matchLine(text, 'cn', 3, 128), ['a'.repeat(128)])
      assert.deepStrictEqual(chars.matchLine('a b c'), [])
      assert.deepStrictEqual(chars.matchLine('foo bar'), ['foo', 'bar'])
      assert.deepStrictEqual(chars.matchLine('?foo bar'), ['foo', 'bar'])
      assert.deepStrictEqual(chars.matchLine('?foo $'), ['foo'])
      assert.deepStrictEqual(chars.matchLine('?foo foo foo'), ['foo'])
      assert.deepStrictEqual(chars.matchLine(' 你好foo'), ['你好', 'foo'])
      assert.deepStrictEqual(chars.matchLine('bar你好', 'cn'), ['bar', '你好'])
      assert.deepStrictEqual(chars.matchLine('foo😍bar foo，bar'), ['foo', 'bar'])
      assert.notStrictEqual(chars.matchLine('你好世界', ''), undefined)
    })
  })

  describe('iskeyword()', () => {
    it('should check isKeyword', () => {
      let chars = new Chars('@')
      assert.strictEqual(chars.isKeyword('foo'), true)
      assert.strictEqual(chars.isKeyword('f@'), false)
    })
  })
})
