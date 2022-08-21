import { matchScore, matchScoreWithPositions } from '../../completion/match'
import { getInput, shouldIndent, shouldStop } from '../../completion/util'
import { getCharCodes } from '../../util/fuzzy'
import { CompleteOption } from '../../types'
import helper from '../helper'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('shouldStop', () => {
  function createOption(bufnr: number, linenr: number, line: string, colnr: number): Pick<CompleteOption, 'bufnr' | 'linenr' | 'line' | 'colnr'> {
    return { bufnr, linenr, line, colnr }
  }

  it('should check stop', async () => {
    let opt = createOption(1, 1, 'a', 2)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: '' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: ' ' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'fo' }, opt)).toBe(true)
    expect(shouldStop(2, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'foob' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 2, changedtick: 1, pre: 'foob' }, opt)).toBe(true)
    expect(shouldStop(1, 'foo', { line: '', col: 2, lnum: 1, changedtick: 1, pre: 'barb' }, opt)).toBe(true)
  })
})

describe('shouldIndent', () => {
  it('should check indent', async () => {
    let res = shouldIndent('0{,0},0),0],!^F,o,O,e,=endif,=enddef,=endfu,=endfor', 'endfor')
    expect(res).toBe(true)
    res = shouldIndent('', 'endfor')
    expect(res).toBe(false)
    res = shouldIndent('0{,0},0),0],!^F,o,O,e,=endif,=enddef,=endfu,=endfor', 'foo bar')
    expect(res).toBe(false)
  })
})

describe('getInput', () => {
  it('should consider none word character as input', async () => {
    let doc = await helper.createDocument('t.vim')
    let res = getInput(doc, 'a#b#', false)
    expect(res).toBe('a#b#')
    res = getInput(doc, '你b#', true)
    expect(res).toBe('b#')
  })
})

describe('matchScore', () => {
  function score(word: string, input: string): number {
    return matchScore(word, getCharCodes(input))
  }

  it('should match score for last letter', () => {
    expect(score('#!3', '3')).toBe(1)
    expect(score('bar', 'f')).toBe(0)
  })

  it('should match first letter', () => {
    expect(score('abc', 'a')).toBe(5)
    expect(score('Abc', 'a')).toBe(2.5)
    expect(score('__abc', 'a')).toBe(2)
    expect(score('$Abc', 'a')).toBe(1)
    expect(score('$Abc', 'A')).toBe(2)
    expect(score('$Abc', '$A')).toBe(6)
    expect(score('$Abc', '$a')).toBe(5.5)
    expect(score('foo_bar', 'b')).toBe(2)
    expect(score('foo_Bar', 'b')).toBe(1)
    expect(score('_foo_Bar', 'b')).toBe(0.5)
    expect(score('_foo_Bar', 'f')).toBe(2)
    expect(score('bar', 'a')).toBe(1)
    expect(score('fooBar', 'B')).toBe(2)
    expect(score('fooBar', 'b')).toBe(1)
  })

  it('should match follow letters', () => {
    expect(score('abc', 'ab')).toBe(6)
    expect(score('adB', 'ab')).toBe(5.75)
    expect(score('adb', 'ab')).toBe(5.1)
    expect(score('adCB', 'ab')).toBe(5.05)
    expect(score('a_b_c', 'ab')).toBe(6)
    expect(score('FooBar', 'fb')).toBe(3.25)
    expect(score('FBar', 'fb')).toBe(3)
    expect(score('FooBar', 'FB')).toBe(6)
    expect(score('FBar', 'FB')).toBe(6)
    expect(score('a__b', 'a__b')).toBe(8)
    expect(score('aBc', 'ab')).toBe(5.5)
    expect(score('a_B_c', 'ab')).toBe(5.75)
    expect(score('abc', 'abc')).toBe(7)
    expect(score('abc', 'aC')).toBe(0)
    expect(score('abc', 'ac')).toBe(5.1)
    expect(score('abC', 'ac')).toBe(5.75)
    expect(score('abC', 'aC')).toBe(6)
  })

  it('should only allow search once', () => {
    expect(score('foobar', 'fbr')).toBe(5.2)
    expect(score('foobaRow', 'fbr')).toBe(5.85)
    expect(score('foobaRow', 'fbR')).toBe(6.1)
    expect(score('foobar', 'fa')).toBe(5.1)
  })

  it('should have higher score for strict match', () => {
    expect(score('language-client-protocol', 'lct')).toBe(6.1)
    expect(score('language-client-types', 'lct')).toBe(7)
  })

  it('should find highest score', () => {
    expect(score('ArrayRotateTail', 'art')).toBe(3.6)
  })
})

describe('matchScoreWithPositions', () => {
  function assertMatch(word: string, input: string, res: [number, ReadonlyArray<number>] | undefined): void {
    let result = matchScoreWithPositions(word, getCharCodes(input))
    if (!res) {
      expect(result).toBeUndefined()
    } else {
      expect(result).toEqual(res)
    }
  }

  it('should return undefined when not match found', async () => {
    assertMatch('a', 'abc', undefined)
    assertMatch('a', '', undefined)
    assertMatch('ab', 'ac', undefined)
  })

  it('should find matches by position fix', async () => {
    assertMatch('this', 'tih', [5.6, [0, 1, 2]])
    assertMatch('globalThis', 'tihs', [2.6, [6, 7, 8, 9]])
  })

  it('should find matched positions', async () => {
    assertMatch('this', 'th', [6, [0, 1]])
    assertMatch('foo_bar', 'fb', [6, [0, 4]])
    assertMatch('assertMatch', 'am', [5.75, [0, 6]])
  })
})
