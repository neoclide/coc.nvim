import { matchScoreWithPositions } from '../../completion/match'
import { FuzzyMatch } from '../../model/fuzzyMatch'
import { getCharCodes } from '../../util/fuzzy'

describe('FuzzyMatch', () => {

  it('should throw when not load', async () => {
    let fn = () => {
      let p = new FuzzyMatch()
      p.setPattern('foo')
    }
    expect(fn).toThrow(Error)
  })

  it('should throw when not set pattern', async () => {
    let p = new FuzzyMatch()
    await p.load()
    let fn = () => {
      p.match('text')
    }
    expect(fn).toThrow(Error)
    p.dispose()
    p.dispose()
  })

  it('should slice pattern when necessary', async () => {
    let pat = 'a'.repeat(258)
    let p = new FuzzyMatch()
    await p.load()
    p.setPattern(pat)
    let res = p.match('a'.repeat(260))
    expect(res).toBeDefined()
    expect(res.positions.length).toBe(256)
  })

  it('should increase content size when necessary', async () => {
    let p = new FuzzyMatch()
    await p.load()
    p.setPattern('p')
    let res = p.match('b'.repeat(4096))
    expect(res).toBeUndefined()
    expect(p.getSizes()[0]).toBe(4097)
  })

  it('should fuzzy match ascii', async () => {
    let p = new FuzzyMatch()
    await p.load()
    await p.load()
    p.setPattern('fb')
    let res = p.match('fooBar')
    expect(res).toBeDefined()
    expect(Array.from(res.positions)).toEqual([0, 3])
    res = p.match('foaab')
    expect(res).toBeDefined()
    expect(Array.from(res.positions)).toEqual([0, 4])
  })

  it('should fuzzy match multi byte', async () => {
    let p = new FuzzyMatch()
    await p.load()
    p.setPattern('f你好')
    let res = p.match('foo你好Bar')
    expect(Array.from(res.positions)).toEqual([0, 3, 4])
  })

  it('should support matchSeq', async () => {
    let p = new FuzzyMatch()
    await p.load()
    p.setPattern('foob')
    let res = p.match('fooBar')
    expect(Array.from(res.positions)).toEqual([0, 1, 2, 3])
    p.setPattern('f b', true)
    res = p.match('foo bar')
    expect(Array.from(res.positions)).toEqual([0, 3, 4])
  })

  it('should better performance', async () => {
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
    for (let i = 0; i < 4000; i++) {
      arr.push(makeid(50))
    }
    let pat = makeid(5)
    let p = new FuzzyMatch()
    await p.load()
    p.setPattern(pat, true)
    let ts = Date.now()
    for (const text of arr) {
      p.match(text)
    }
    console.log(Date.now() - ts)
    let codes = getCharCodes(pat)
    ts = Date.now()
    for (const text of arr) {
      matchScoreWithPositions(text, codes)
    }
    console.log(Date.now() - ts)
  })
})
