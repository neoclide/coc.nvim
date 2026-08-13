import { matchScoreWithPositions } from '../../completion/match'
import { FuzzyMatch, matchSpansReverse, FuzzyWasi, initFuzzyWasm } from '../../model/fuzzyMatch'
import { getCharCodes } from '../../util/fuzzy'

describe('FuzzyMatch', () => {
  let api: FuzzyWasi
  before(async () => {
    api = await initFuzzyWasm()
  })

  it('should match spans', () => {
    let f = new FuzzyMatch(api)
    const verify = (input: string, positions: number[], results: [number, number][], max?: number) => {
      let arr = f.matchSpans(input, positions, max)
      let res: [number, number][] = []
      for (let item of arr) {
        res.push(item)
      }
      assert.deepStrictEqual(res, results)
    }
    verify('foobar', [0, 1, 3], [[0, 2], [3, 4]])
    verify('foobar', [0], [[0, 1]])
    verify('你', [0], [[0, 3]])
    verify(' 你', [1], [[1, 4]])
    verify('foobar', [0, 2, 3, 4, 1], [[0, 1], [2, 5]])
    verify('foobar', [10], [])
    verify('foobar', [0, 2, 4], [[0, 1], [2, 3], [4, 5]])
    verify('foobar', [1, 4], [[1, 2]], 3)
    verify('foobar', [5], [], 3)
  })

  it('should should matchSpansReverse', () => {
    const verify = (input: string, positions: number[], results: [number, number][], endIndex?: number, max?: number) => {
      let arr = matchSpansReverse(input, positions, endIndex, max)
      let res: [number, number][] = []
      for (let item of arr) {
        res.push(item)
      }
      assert.deepStrictEqual(res, results)
    }
    verify('foobar', [3, 1, 0], [[0, 2], [3, 4]])
    verify('foobar', [-1, 2, 3, 1, 0], [[0, 2], [3, 4]], 2)
    verify('foobar', [0], [[0, 1]])
    verify('你', [0], [[0, 3]])
    verify(' 你', [1], [[1, 4]])
    verify('foobar', [5, 4, 3, 2, 1], [[1, 6]])
    verify('foobar', [5], [], 0, 2)
    verify('foobar', [5, 1], [[1, 2]], 0, 2)
    verify('f', [0, 1], [], 3)
    verify('foo', [0, 1, 0, 0, 0], [[0, 1]])
  })

  it('should createScoreFunction', async () => {
    let f = new FuzzyMatch(api)
    let fn = f.createScoreFunction('a', 0)
    assert.notStrictEqual(fn, undefined)
    fn = f.createScoreFunction('a', 0, undefined, 'normal')
    assert.notStrictEqual(fn, undefined)
    fn = f.createScoreFunction('a', 0, undefined, 'aggressive')
    assert.notStrictEqual(fn, undefined)
    fn = f.createScoreFunction('a', 0, undefined, 'any')
    assert.notStrictEqual(fn, undefined)
    let res = fn('asdf')
    assert.notStrictEqual(res, undefined)
    assert.strictEqual(res[2], 0)
    let spans: [number, number][] = []
    for (let span of f.matchScoreSpans('asdf', res)) {
      spans.push(span)
    }
    assert.deepStrictEqual(spans, [[0, 1]])
    res = fn('asdf')
    assert.notStrictEqual(res, undefined)
  })

  it('should throw when not set pattern', () => {
    let p = new FuzzyMatch(api)
    let fn = () => {
      p.match('text')
    }
    assert.throws(fn, Error)
    p.free()
  })

  it('should fallback to JS scorer when wasm not ready', () => {
    let p = new FuzzyMatch(undefined)
    p.setPattern('foo')
    let res = p.match('foobar')
    assert.notStrictEqual(res, undefined)
    assert.ok(res.score > 0)
    assert.deepStrictEqual(Array.from(res.positions), [0, 1, 2])
    p.free()
  })

  it('should fallback to JS scorer with empty pattern', () => {
    let p = new FuzzyMatch(undefined)
    p.setPattern('')
    let res = p.match('foo')
    assert.strictEqual(res.score, 100)
    assert.strictEqual(res.positions.length, 0)
  })

  it('should fallback to JS scorer for highlights', () => {
    let p = new FuzzyMatch(undefined)
    p.setPattern('你好')
    let res = p.matchHighlights('你好世界', 'CocSearch')
    assert.notStrictEqual(res, undefined)
    assert.ok(res.score > 0)
    assert.strictEqual(res.highlights[0].hlGroup, 'CocSearch')
    assert.deepStrictEqual(res.highlights[0].span, [0, 6])
    p.free()
  })

  it('should throw when not set pattern without wasm', () => {
    let p = new FuzzyMatch(undefined)
    assert.throws(() => {
      p.match('text')
    }, Error)
  })

  it('should slice pattern when necessary', () => {
    let pat = 'a'.repeat(258)
    let p = new FuzzyMatch(api)
    p.setPattern(pat)
    let res = p.match('a'.repeat(260))
    assert.notStrictEqual(res, undefined)
    assert.strictEqual(res.positions.length, 256)
  })

  it('should match empty pattern', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('')
    let res = p.match('foo')
    assert.strictEqual(res.score, 100)
    assert.strictEqual(res.positions.length, 0)
  })

  it('should increase content size when necessary', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('p')
    let res = p.match('b'.repeat(2100))
    assert.strictEqual(res, undefined)
    assert.strictEqual(p.getSizes()[0], 2101)
    p.free()
  })

  it('should slice content when necessary', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('a')
    let res = p.match('b'.repeat(40960))
    assert.strictEqual(res, undefined)
    assert.strictEqual(p.getSizes()[0], 4097)
    p.free()
    p.free()
  })

  it('should fuzzy match ascii', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('fb')
    let res = p.match('fooBar')
    assert.notStrictEqual(res, undefined)
    assert.deepStrictEqual(Array.from(res.positions), [0, 3])
    res = p.match('foaab')
    assert.notStrictEqual(res, undefined)
    assert.deepStrictEqual(Array.from(res.positions), [0, 4])
  })

  it('should fuzzy match multi byte', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('f你好')
    let res = p.match('foo你好Bar')
    assert.deepStrictEqual(Array.from(res.positions), [0, 3, 4])
  })

  it('should match highlights', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('fb')
    let res = p.matchHighlights('fooBar', 'Text')
    assert.notStrictEqual(res, undefined)
    assert.deepStrictEqual(res.highlights, [
      { span: [0, 1], hlGroup: 'Text' },
      { span: [3, 4], hlGroup: 'Text' }
    ])
    p.setPattern('你')
    res = p.matchHighlights('吃了吗你', 'Text')
    assert.notStrictEqual(res, undefined)
    assert.deepStrictEqual(res.highlights, [
      { span: [9, 12], hlGroup: 'Text' }
    ])
    res = p.matchHighlights('abc', 'Text')
    assert.strictEqual(res, undefined)
  })

  it('should support matchSeq', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('foob')
    let res = p.match('fooBar')
    assert.deepStrictEqual(Array.from(res.positions), [0, 1, 2, 3])
    p.setPattern('f b', true)
    res = p.match('foo bar')
    assert.deepStrictEqual(Array.from(res.positions), [0, 3, 4])
  })

  it('should better performance', () => {
    function makeid(length) {
      let result = ''
      let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
      let charactersLength = characters.length
      for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
          charactersLength))
      }
      return result
    }
    let arr: string[] = []
    for (let i = 0; i < 8000; i++) {
      arr.push(makeid(50))
    }
    let pat = makeid(3)
    let p = new FuzzyMatch(api)
    p.setPattern(pat, true)
    let ts = Date.now()
    for (const text of arr) {
      p.match(text)
    }
    // console.log(Date.now() - ts)
    let codes = getCharCodes(pat)
    ts = Date.now()
    for (const text of arr) {
      matchScoreWithPositions(text, codes)
    }
    // console.log(Date.now() - ts)
  })
})
