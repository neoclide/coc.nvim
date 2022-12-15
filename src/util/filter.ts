import { CharCode } from './charCode'
import { isEmojiImprecise } from './string'

/**
 * An array representing a fuzzy match.
 *
 * 0. the score
 * 1. the offset at which matching started
 * 2. `<match_pos_N>`
 * 3. `<match_pos_1>`
 * 4. `<match_pos_0>` etc
 */
export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]]
const _maxLen = 128
const enum Arrow { Diag = 1, Left = 2, LeftLeft = 3 }

export interface FuzzyScoreOptions {
  readonly boostFullMatch: boolean
  readonly firstMatchCanBeWeak: boolean
}

export interface IMatch {
  start: number
  end: number
}

export interface FuzzyScorer {
  (pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined
}

function initTable() {
  const table: number[][] = []
  const row: number[] = []
  for (let i = 0; i <= _maxLen; i++) {
    row[i] = 0
  }
  for (let i = 0; i <= _maxLen; i++) {
    table.push(row.slice(0))
  }
  return table
}

function initArr(maxLen: number) {
  const row: number[] = []
  for (let i = 0; i <= maxLen; i++) {
    row[i] = 0
  }
  return row
}

function isUpperCaseAtPos(pos: number, word: string, wordLow: string): boolean {
  return word[pos] !== wordLow[pos]
}

const _minWordMatchPos = initArr(2 * _maxLen) // min word position for a certain pattern position
const _maxWordMatchPos = initArr(2 * _maxLen) // max word position for a certain pattern position
const _diag = initTable() // the length of a contiguous diagonal match
const _table = initTable()
const _arrows = initTable() as Arrow[][]

export function fuzzyScoreGracefulAggressive(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined {
  return fuzzyScoreWithPermutations(pattern, lowPattern, patternPos, word, lowWord, wordPos, true, options)
}

export function fuzzyScoreGraceful(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined {
  return fuzzyScoreWithPermutations(pattern, lowPattern, patternPos, word, lowWord, wordPos, false, options)
}

function fuzzyScoreWithPermutations(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, aggressive: boolean, options?: FuzzyScoreOptions): FuzzyScore | undefined {
  let top = fuzzyScore(pattern, lowPattern, patternPos, word, lowWord, wordPos, options)

  if (top && !aggressive) {
    // when using the original pattern yield a result we`
    // return it unless we are aggressive and try to find
    // a better alignment, e.g. `cno` -> `^co^ns^ole` or `^c^o^nsole`.
    return top
  }

  if (pattern.length >= 3) {
    // When the pattern is long enough then try a few (max 7)
    // permutations of the pattern to find a better match. The
    // permutations only swap neighbouring characters, e.g
    // `cnoso` becomes `conso`, `cnsoo`, `cnoos`.
    const tries = Math.min(7, pattern.length - 1)
    for (let movingPatternPos = patternPos + 1; movingPatternPos < tries; movingPatternPos++) {
      const newPattern = nextTypoPermutation(pattern, movingPatternPos)
      if (newPattern) {
        const candidate = fuzzyScore(newPattern, newPattern.toLowerCase(), patternPos, word, lowWord, wordPos, options)
        if (candidate) {
          candidate[0] -= 3 // permutation penalty
          if (!top || candidate[0] > top[0]) {
            top = candidate
          }
        }
      }
    }
  }

  return top
}

export function fuzzyScore(pattern: string, patternLow: string, patternStart: number, word: string, wordLow: string, wordStart: number, options: FuzzyScoreOptions = { boostFullMatch: true, firstMatchCanBeWeak: false }): FuzzyScore | undefined {

  const patternLen = pattern.length > _maxLen ? _maxLen : pattern.length
  const wordLen = word.length > _maxLen ? _maxLen : word.length

  if (patternStart >= patternLen || wordStart >= wordLen || (patternLen - patternStart) > (wordLen - wordStart)) {
    return undefined
  }

  // Run a simple check if the characters of pattern occur
  // (in order) at all in word. If that isn't the case we
  // stop because no match will be possible
  if (!isPatternInWord(patternLow, patternStart, patternLen, wordLow, wordStart, wordLen, true)) {
    return undefined
  }

  // Find the max matching word position for each pattern position
  // NOTE: the min matching word position was filled in above, in the `isPatternInWord` call
  _fillInMaxWordMatchPos(patternLen, wordLen, patternStart, wordStart, patternLow, wordLow)

  let row = 1
  let column = 1
  let patternPos = patternStart
  let wordPos = wordStart

  const hasStrongFirstMatch = [false]

  // There will be a match, fill in tables
  for (row = 1, patternPos = patternStart; patternPos < patternLen; row++, patternPos++) {

    // Reduce search space to possible matching word positions and to possible access from next row
    const minWordMatchPos = _minWordMatchPos[patternPos]
    const maxWordMatchPos = _maxWordMatchPos[patternPos]
    const nextMaxWordMatchPos = (patternPos + 1 < patternLen ? _maxWordMatchPos[patternPos + 1] : wordLen)

    for (column = minWordMatchPos - wordStart + 1, wordPos = minWordMatchPos; wordPos < nextMaxWordMatchPos; column++, wordPos++) {

      let score = Number.MIN_SAFE_INTEGER
      let canComeDiag = false

      if (wordPos <= maxWordMatchPos) {
        score = _doScore(
          pattern, patternLow, patternPos, patternStart,
          word, wordLow, wordPos, wordLen, wordStart,
          _diag[row - 1][column - 1] === 0,
          hasStrongFirstMatch
        )
      }

      let diagScore = 0
      canComeDiag = true
      diagScore = score + _table[row - 1][column - 1]

      const canComeLeft = wordPos > minWordMatchPos
      const leftScore = canComeLeft ? _table[row][column - 1] + (_diag[row][column - 1] > 0 ? -5 : 0) : 0 // penalty for a gap start

      const canComeLeftLeft = wordPos > minWordMatchPos + 1 && _diag[row][column - 1] > 0
      const leftLeftScore = canComeLeftLeft ? _table[row][column - 2] + (_diag[row][column - 2] > 0 ? -5 : 0) : 0 // penalty for a gap start

      if (canComeLeftLeft && (!canComeLeft || leftLeftScore >= leftScore) && (!canComeDiag || leftLeftScore >= diagScore)) {
        // always prefer choosing left left to jump over a diagonal because that means a match is earlier in the word
        _table[row][column] = leftLeftScore
        _arrows[row][column] = Arrow.LeftLeft
        _diag[row][column] = 0
      } else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
        // always prefer choosing left since that means a match is earlier in the word
        _table[row][column] = leftScore
        _arrows[row][column] = Arrow.Left
        _diag[row][column] = 0
      } else {
        _table[row][column] = diagScore
        _arrows[row][column] = Arrow.Diag
        _diag[row][column] = _diag[row - 1][column - 1] + 1
      }
    }
  }

  // if (_debug) {
  //   printTables(pattern, patternStart, word, wordStart)
  // }

  if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
    return undefined
  }

  row--
  column--

  const result: FuzzyScore = [_table[row][column], wordStart]

  let backwardsDiagLength = 0
  let maxMatchColumn = 0

  while (row >= 1) {
    // Find the column where we go diagonally up
    let diagColumn = column
    do {
      const arrow = _arrows[row][diagColumn]
      if (arrow === Arrow.LeftLeft) {
        diagColumn = diagColumn - 2
      } else if (arrow === Arrow.Left) {
        diagColumn = diagColumn - 1
      } else {
        // found the diagonal
        break
      }
    } while (diagColumn >= 1)

    // Overturn the "forwards" decision if keeping the "backwards" diagonal would give a better match
    if (
      backwardsDiagLength > 1 // only if we would have a contiguous match of 3 characters
      && patternLow[patternStart + row - 1] === wordLow[wordStart + column - 1] // only if we can do a contiguous match diagonally
      && !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow) // only if the forwards chose diagonal is not an uppercase
      && backwardsDiagLength + 1 > _diag[row][diagColumn] // only if our contiguous match would be longer than the "forwards" contiguous match
    ) {
      diagColumn = column
    }

    if (diagColumn === column) {
      // this is a contiguous match
      backwardsDiagLength++
    } else {
      backwardsDiagLength = 1
    }

    if (!maxMatchColumn) {
      // remember the last matched column
      maxMatchColumn = diagColumn
    }

    row--
    column = diagColumn - 1
    result.push(column)
  }

  if (wordLen === patternLen && options.boostFullMatch) {
    // the word matches the pattern with all characters!
    // giving the score a total match boost (to come up ahead other words)
    result[0] += 2
  }

  // Add 1 penalty for each skipped character in the word
  const skippedCharsCount = maxMatchColumn - patternLen
  result[0] -= skippedCharsCount

  return result
}

export function anyScore(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore {
  const max = Math.min(13, pattern.length)
  for (; patternPos < max; patternPos++) {
    const result = fuzzyScore(pattern, lowPattern, patternPos, word, lowWord, wordPos, options)
    if (result) {
      return result
    }
  }
  return [0, wordPos]
}

export function createMatches(score: undefined | FuzzyScore): IMatch[] {
  if (typeof score === 'undefined') {
    return []
  }
  const res: IMatch[] = []
  const wordPos = score[1]
  for (let i = score.length - 1; i > 1; i--) {
    const pos = score[i] + wordPos
    const last = res[res.length - 1]
    if (last && last.end === pos) {
      last.end = pos + 1
    } else {
      res.push({ start: pos, end: pos + 1 })
    }
  }
  return res
}

function _doScore(
  pattern: string, patternLow: string, patternPos: number, patternStart: number,
  word: string, wordLow: string, wordPos: number, wordLen: number, wordStart: number,
  newMatchStart: boolean,
  outFirstMatchStrong: boolean[],
): number {
  if (patternLow[patternPos] !== wordLow[wordPos]) {
    return Number.MIN_SAFE_INTEGER
  }

  let score = 1
  let isGapLocation = false
  if (wordPos === (patternPos - patternStart)) {
    // common prefix: `foobar <-> foobaz`
    //                            ^^^^^
    score = pattern[patternPos] === word[wordPos] ? 7 : 5

  } else if (isUpperCaseAtPos(wordPos, word, wordLow) && (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))) {
    // hitting upper-case: `foo <-> forOthers`
    //                              ^^ ^
    score = pattern[patternPos] === word[wordPos] ? 7 : 5
    isGapLocation = true

  } else if (isSeparatorAtPos(wordLow, wordPos) && (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))) {
    // hitting a separator: `. <-> foo.bar`
    //                                ^
    score = 5

  } else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
    // post separator: `foo <-> bar_foo`
    //                              ^^^
    score = 5
    isGapLocation = true
  }

  if (score > 1 && patternPos === patternStart) {
    outFirstMatchStrong[0] = true
  }

  if (!isGapLocation) {
    isGapLocation = isUpperCaseAtPos(wordPos, word, wordLow) || isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)
  }

  //
  if (patternPos === patternStart) { // first character in pattern
    if (wordPos > wordStart) {
      // the first pattern character would match a word character that is not at the word start
      // so introduce a penalty to account for the gap preceding this match
      score -= isGapLocation ? 3 : 5
    }
  } else {
    if (newMatchStart) {
      // this would be the beginning of a new match (i.e. there would be a gap before this location)
      score += isGapLocation ? 2 : 0
    } else {
      // this is part of a contiguous match, so give it a slight bonus, but do so only if it would not be a preferred gap location
      score += isGapLocation ? 0 : 1
    }
  }

  if (wordPos + 1 === wordLen) {
    // we always penalize gaps, but this gives unfair advantages to a match that would match the last character in the word
    // so pretend there is a gap after the last character in the word to normalize things
    score -= isGapLocation ? 3 : 5
  }

  return score
}

export function isSeparatorAtPos(value: string, index: number): boolean {
  const code = value.codePointAt(index)
  switch (code) {
    case CharCode.Underline:
    case CharCode.Dash:
    case CharCode.Period:
    case CharCode.Space:
    case CharCode.Slash:
    case CharCode.Backslash:
    case CharCode.SingleQuote:
    case CharCode.DoubleQuote:
    case CharCode.Colon:
    case CharCode.DollarSign:
    case CharCode.LessThan:
    case CharCode.GreaterThan:
    case CharCode.OpenParen:
    case CharCode.CloseParen:
    case CharCode.OpenSquareBracket:
    case CharCode.CloseSquareBracket:
    case CharCode.OpenCurlyBrace:
    case CharCode.CloseCurlyBrace:
      return true
    case undefined:
      return false
    default:
      if (isEmojiImprecise(code)) {
        return true
      }
      return false
  }
}

export function isWhitespaceAtPos(value: string, index: number): boolean {
  if (index < 0 || index >= value.length) {
    return false
  }
  const code = value.charCodeAt(index)
  switch (code) {
    case CharCode.Space:
    case CharCode.Tab:
      return true
    default:
      return false
  }
}

export function isPatternInWord(patternLow: string, patternPos: number, patternLen: number, wordLow: string, wordPos: number, wordLen: number, fillMinWordPosArr = false): boolean {
  while (patternPos < patternLen && wordPos < wordLen) {
    if (patternLow[patternPos] === wordLow[wordPos]) {
      if (fillMinWordPosArr) {
        // Remember the min word position for each pattern position
        _minWordMatchPos[patternPos] = wordPos
      }
      patternPos += 1
    }
    wordPos += 1
  }
  return patternPos === patternLen // pattern must be exhausted
}

function _fillInMaxWordMatchPos(patternLen: number, wordLen: number, patternStart: number, wordStart: number, patternLow: string, wordLow: string) {
  let patternPos = patternLen - 1
  let wordPos = wordLen - 1
  while (patternPos >= patternStart && wordPos >= wordStart) {
    if (patternLow[patternPos] === wordLow[wordPos]) {
      _maxWordMatchPos[patternPos] = wordPos
      patternPos--
    }
    wordPos--
  }
}

export function nextTypoPermutation(pattern: string, patternPos: number): string | undefined {
  if (patternPos + 1 >= pattern.length) {
    return undefined
  }
  const swap1 = pattern[patternPos]
  const swap2 = pattern[patternPos + 1]
  if (swap1 === swap2) {
    return undefined
  }
  return pattern.slice(0, patternPos)
    + swap2
    + swap1
    + pattern.slice(patternPos + 2)
}
