import { getCharCodes, caseMatch, wordChar } from '../util/fuzzy'

function nextWordIndex(start = 0, codes: number[]): number {
  if (start == 0) {
    if (wordChar(codes[0])) return 0
    start = 1
  }
  let pre = codes[start - 1]
  for (let i = start; i < codes.length; i++) {
    const ch = codes[i]
    if (wordChar(ch)) {
      if (!wordChar(pre) || (ch >= 65 && ch <= 90 && pre >= 97 && pre <= 122)) {
        return i
      }
    }
    pre = ch
  }
  return -1
}

// get score for word from input codes
export function matchScore(word: string, input: number[]): number {
  if (input.length == 0) return 0
  let searched = false
  let codes = getCharCodes(word)
  let score = 0
  let first = input[0]
  let idx = 1
  if (wordChar(first)) {
    let index = nextWordIndex(0, codes)
    if (index == -1) return 0
    let ch = codes[index]
    if (caseMatch(first, ch)) {
      let add = first == ch ? 5 : 1
      if (index != 0) add = add / 2
      score += add
      idx = index + 1
    } else {
      // first word not match
      index = nextWordIndex(index + 1, codes)
      if (index != -1) {
        let ch = codes[index]
        if (caseMatch(first, ch)) {
          score += first == ch ? 2.5 : 1
          idx = index + 1
        }
      }
    }
  } else {
    if (first != codes[0]) return 0
    score += 5
  }
  if (score == 0) {
    let index = codes.indexOf(first)
    if (index !== -1) {
      searched = true
      score += 0.5
      idx = index + 1
    }
  }
  if (score == 0) return 0
  for (let i = 1; i < input.length; i++) {
    const ch = input[i]
    if (idx == codes.length) return 0
    let next = codes[idx]
    // next match
    if (caseMatch(ch, next)) {
      score += ch == next ? 1 : 0.5
      idx += 1
      continue
    }
    // search for none word
    if (!wordChar(ch)) {
      let add = 0
      for (let i = idx + 1; i < codes.length; i++) {
        if (codes[i] == ch) {
          add = 1
          idx = i + 1
          break
        }
      }
      if (!add) return 0
      score += add
      continue
    }
    let n = nextWordIndex(idx + 1, codes)
    // next word match
    if (n != -1 && caseMatch(ch, codes[n])) {
      score += ch == codes[n] ? 1 : 0.5
      idx = n + 1
      continue
    }
    // only allow once
    if (searched) return 0
    searched = true
    let add = 0
    // character search
    for (let i = idx + 1; i < codes.length; i++) {
      if (caseMatch(ch, codes[i])) {
        add = ch == codes[i] ? 0.1 : 0.05
        idx = i + 1
        break
      }
    }
    if (!add) return 0
    score += add
  }
  if (word.length === input.length) {
    score += 0.2
  }
  return score
}
