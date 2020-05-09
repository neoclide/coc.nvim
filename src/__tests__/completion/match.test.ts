import { matchScore } from '../../completion/match'
import { getCharCodes } from '../../util/fuzzy'

function score(word: string, input: string): number {
  return matchScore(word, getCharCodes(input))
}

describe('matchScore', () => {

  it('should match score for last letter', () => {
    expect(score('#!3', '3')).toBe(1)
  })

  it('should match first letter', () => {
    expect(score('abc', 'a')).toBe(5)
    expect(score('Abc', 'a')).toBe(2.5)
    expect(score('__abc', 'a')).toBe(2.5)
    expect(score('$Abc', 'a')).toBe(2)
    expect(score('$Abc', 'A')).toBe(2.5)
    expect(score('$Abc', '$A')).toBe(6)
    expect(score('$Abc', '$a')).toBe(5.5)
    expect(score('foo_bar', 'b')).toBe(2.5)
    expect(score('foo_Bar', 'b')).toBe(2)
    expect(score('_foo_Bar', 'b')).toBe(0.5)
    expect(score('_foo_Bar', 'f')).toBe(2.5)
    expect(score('bar', 'a')).toBe(1)
    expect(score('fooBar', 'B')).toBe(2.5)
    expect(score('fooBar', 'b')).toBe(2)
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
    expect(score('foobar', 'fbr')).toBe(0)
    expect(score('foobaRow', 'fbr')).toBe(5.85)
    expect(score('foobaRow', 'fbR')).toBe(6.1)
    expect(score('foobar', 'fa')).toBe(5.1)
  })

  it('should have higher score for strict match', () => {
    expect(score('language-client-protocol', 'lct')).toBe(6.1)
    expect(score('language-client-types', 'lct')).toBe(7)
  })

  it('should find highest score', () => {
    expect(score('ArrayRotateTail', 'art')).toBe(4)
  })
})
