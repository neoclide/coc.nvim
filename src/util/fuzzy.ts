
export function getCharCodes(str: string): number[] {
  let res = []
  for (let i = 0, l = str.length; i < l; i++) {
    res.push(str.charCodeAt(i))
  }
  return res
}

export function fuzzyChar(a: string, b: string): boolean {
  let ca = a.charCodeAt(0)
  let cb = b.charCodeAt(0)
  if (ca === cb) return true
  if (ca >= 97 && ca <= 122 && cb + 32 === ca) return true
  return false
}

export function matchScore(input: string, word: string): number {
  if (word.length < input.length) return 0
  let n = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch == word[i]) {
      n = n + 1
    } else if (fuzzyChar(ch, word[i])) {
      n = n + 0.5
    } else {
      break
    }
  }
  return n
}

// upper case must match, lower case ignore case
export function fuzzyMatch(needle: number[], input: string): boolean {
  let totalCount = needle.length
  let i = 0
  for (let j = 0; j < input.length; j++) {
    if (i === totalCount) break
    let code = input.charCodeAt(j)
    let m = needle[i]
    if (code === m) {
      i = i + 1
      continue
    }
    // upper case match lower case
    if ((m >= 97 && m <= 122) && code + 32 === m) {
      i = i + 1
      continue
    }
  }
  return i === totalCount
}
