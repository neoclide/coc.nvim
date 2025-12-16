import { matchScoreWithPositions } from '../../completion/match'
import { FuzzyMatch, matchSpansReverse, FuzzyWasi, initFuzzyWasm } from '../../model/fuzzyMatch'
import { getCharCodes } from '../../util/fuzzy'

describe('FuzzyMatch', () => {
  let api: FuzzyWasi
  beforeAll(async () => {
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
      expect(res).toEqual(results)
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
      expect(res).toEqual(results)
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
    expect(fn).toBeDefined()
    fn = f.createScoreFunction('a', 0, undefined, 'normal')
    expect(fn).toBeDefined()
    fn = f.createScoreFunction('a', 0, undefined, 'aggressive')
    expect(fn).toBeDefined()
    fn = f.createScoreFunction('a', 0, undefined, 'any')
    expect(fn).toBeDefined()
    let res = fn('asdf')
    expect(res).toBeDefined()
    expect(res[2]).toBe(0)
    let spans: [number, number][] = []
    for (let span of f.matchScoreSpans('asdf', res)) {
      spans.push(span)
    }
    expect(spans).toEqual([[0, 1]])
    res = fn('asdf')
    expect(res).toBeDefined()
  })

  it('should throw when not set pattern', () => {
    let p = new FuzzyMatch(api)
    let fn = () => {
      p.match('text')
    }
    expect(fn).toThrow(Error)
    p.free()
  })

  it('should slice pattern when necessary', () => {
    let pat = 'a'.repeat(258)
    let p = new FuzzyMatch(api)
    p.setPattern(pat)
    let res = p.match('a'.repeat(260))
    expect(res).toBeDefined()
    expect(res.positions.length).toBe(256)
  })

  it('should match empty pattern', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('')
    let res = p.match('foo')
    expect(res.score).toBe(100)
    expect(res.positions.length).toBe(0)
  })

  it('should increase content size when necessary', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('p')
    let res = p.match('b'.repeat(2100))
    expect(res).toBeUndefined()
    expect(p.getSizes()[0]).toBe(2101)
    p.free()
  })

  it('should slice content when necessary', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('a')
    let res = p.match('b'.repeat(40960))
    expect(res).toBeUndefined()
    expect(p.getSizes()[0]).toBe(4097)
    p.free()
    p.free()
  })

  it('should fuzzy match ascii', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('fb')
    let res = p.match('fooBar')
    expect(res).toBeDefined()
    expect(Array.from(res.positions)).toEqual([0, 3])
    res = p.match('foaab')
    expect(res).toBeDefined()
    expect(Array.from(res.positions)).toEqual([0, 4])
  })

  it('should fuzzy match multi byte', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('f你好')
    let res = p.match('foo你好Bar')
    expect(Array.from(res.positions)).toEqual([0, 3, 4])
  })

  it('should match highlights', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('fb')
    let res = p.matchHighlights('fooBar', 'Text')
    expect(res).toBeDefined()
    expect(res.highlights).toEqual([
      { span: [0, 1], hlGroup: 'Text' },
      { span: [3, 4], hlGroup: 'Text' }
    ])
    p.setPattern('你')
    res = p.matchHighlights('吃了吗你', 'Text')
    expect(res).toBeDefined()
    expect(res.highlights).toEqual([
      { span: [9, 12], hlGroup: 'Text' }
    ])
    res = p.matchHighlights('abc', 'Text')
    expect(res).toBeUndefined()
  })

  it('should support matchSeq', () => {
    let p = new FuzzyMatch(api)
    p.setPattern('foob')
    let res = p.match('fooBar')
    expect(Array.from(res.positions)).toEqual([0, 1, 2, 3])
    p.setPattern('f b', true)
    res = p.match('foo bar')
    expect(Array.from(res.positions)).toEqual([0, 3, 4])
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
