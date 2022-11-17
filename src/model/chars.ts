'use strict'
import { Range } from 'vscode-languageserver-types'
import { waitImmediate } from '../util'
import { intable } from '../util/array'
import { hasOwnProperty } from '../util/object'
import { CancellationToken } from '../util/protocol'

// Word ranges from vim, tested by '\k' option when '@' in iskeyword option.
const WORD_RANGES: [number, number][] = [[257, 893], [895, 902], [904, 1369], [1376, 1416], [1418, 1469], [1471, 1471], [1473, 1474], [1476, 1522], [1525, 1547], [1549, 1562], [1564, 1566], [1568, 1641], [1646, 1747], [1749, 1791], [1806, 2403], [2406, 2415], [2417, 3571], [3573, 3662], [3664, 3673], [3676, 3843], [3859, 3897], [3902, 3972], [3974, 4169], [4176, 4346], [4348, 4960], [4969, 5740], [5743, 5759], [5761, 5786], [5789, 5866], [5870, 5940], [5943, 6099], [6109, 6143], [6155, 8191], [10240, 10495], [10649, 10711], [10716, 10747], [10750, 11775], [11904, 12287], [12321, 12335], [12337, 12348], [12350, 64829], [64832, 65071], [65132, 65279], [65296, 65305], [65313, 65338], [65345, 65370], [65382, 65535]]

const MAX_CODE_UNIT = 65535

export function getCharCode(str: string): number | undefined {
  if (/^\d+$/.test(str)) return parseInt(str, 10)
  if (str.length > 0) return str.charCodeAt(0)
  return undefined
}

export function splitKeywordOption(iskeyword: string): string[] {
  let res: string[] = []
  let i = 0
  let s = 0
  let len = iskeyword.length
  for (; i < len; i++) {
    let c = iskeyword[i]
    if (i + 1 == len && s != len) {
      res.push(iskeyword.slice(s, len))
      continue
    }
    if (c == ',') {
      let d = i - s
      if (d == 0) continue
      if (d == 1) {
        let p = iskeyword[i - 1]
        if (p == '^' || p == ',') {
          res.push(p == ',' ? ',' : '^,')
          s = i + 1
          if (p == '^' && iskeyword[i + 1] == ',') {
            i++
            s++
          }
          continue
        }
      }
      res.push(iskeyword.slice(s, i))
      s = i + 1
    }
  }
  return res
}

export class IntegerRanges {
  /**
   * Sorted ranges without overlap
   */
  constructor(private ranges: [number, number][] = [], public wordChars = false) {
  }

  public clone(): IntegerRanges {
    return new IntegerRanges(this.ranges.slice(), this.wordChars)
  }
  /**
   * Add new range
   */
  public add(start: number, end?: number): void {
    // find newIndex, replace count, new start, new end
    let index = 0
    let removeCount = 0
    if (end != null && end < start) {
      let t = end
      end = start
      start = t
    }
    end = end == null ? start : end
    for (let r of this.ranges) {
      let [s, e] = r
      if (e < start) {
        index++
        continue
      }
      if (s > end) break
      // overlap
      removeCount++
      if (s < start) start = s
      if (e > end) {
        end = e
        break
      }
    }
    this.ranges.splice(index, removeCount, [start, end])
  }

  public exclude(start: number, end?: number): void {
    if (end != null && end < start) {
      let t = end
      end = start
      start = t
    }
    end = end == null ? start : end
    let index = 0
    let removeCount = 0
    let created: [number, number][] = []
    for (let r of this.ranges) {
      let [s, e] = r
      if (e < start) {
        index++
        continue
      }
      if (s > end) break
      removeCount++
      if (s < start) {
        created.push([s, start - 1])
      }
      if (e > end) {
        created.push([end + 1, e])
        break
      }
    }
    if (removeCount == 0 && created.length == 0) return
    this.ranges.splice(index, removeCount, ...created)
  }

  public flatten(): number[] {
    return this.ranges.reduce((p, c) => p.concat(c), [])
  }

  public includes(n: number): boolean {
    if (n > 256 && this.wordChars) return intable(n, WORD_RANGES)
    return intable(n, this.ranges)
  }

  public static fromKeywordOption(iskeyword: string): IntegerRanges {
    let range = new IntegerRanges()
    for (let part of splitKeywordOption(iskeyword)) {
      let exclude = part.length > 1 && part.startsWith('^')
      let method = exclude ? 'exclude' : 'add'
      if (exclude) part = part.slice(1)
      if (part === '@' && !exclude) { // all word class
        range.wordChars = true
        range[method](65, 90)
        range[method](97, 122)
        range[method](192, 255)
      } else if (part == '@-@') {
        range[method]('@'.charCodeAt(0))
      } else if (part.length == 1 || /^\d+$/.test(part)) {
        range[method](getCharCode(part))
      } else if (part.includes('-')) {
        let items = part.split('-', 2)
        let start = getCharCode(items[0])
        let end = getCharCode(items[1])
        if (start === undefined || end === undefined) continue
        range[method](start, end)
      }
    }
    return range
  }
}

export class Chars {
  public ranges: IntegerRanges
  constructor(keywordOption: string) {
    this.ranges = IntegerRanges.fromKeywordOption(keywordOption)
  }

  public addKeyword(ch: string): void {
    this.ranges.add(ch.codePointAt(0))
  }

  public clone(): Chars {
    let chars = new Chars('')
    chars.ranges = this.ranges.clone()
    return chars
  }

  public isKeywordCode(code: number): boolean {
    if (code === 32 || code > MAX_CODE_UNIT) return false
    return this.ranges.includes(code)
  }

  public isKeywordChar(ch: string): boolean {
    let code = ch.charCodeAt(0)
    return this.isKeywordCode(code)
  }

  public isKeyword(word: string): boolean {
    for (let i = 0, l = word.length; i < l; i++) {
      if (!this.isKeywordChar(word[i])) return false
    }
    return true
  }

  public matchLine(line: string, min = 2, max = 1024): string[] {
    let res: string[] = []
    let l = line.length
    if (l > max) {
      line = line.slice(0, max)
      l = max
    }
    let start = -1
    let idx = 0
    const add = (end: number): void => {
      if (end - start < min) return
      let word = line.slice(start, end)
      if (!res.includes(word)) res.push(word)
    }
    for (const codePoint of line) {
      let code = codePoint.codePointAt(0)
      if (this.isKeywordCode(code)) {
        if (start == -1) {
          start = idx
        }
      } else {
        if (start != -1) {
          add(idx)
          start = -1
        }
      }
      if (code > MAX_CODE_UNIT) {
        idx += codePoint.length
      } else {
        idx++
      }
    }
    if (start != -1) add(l)
    return res
  }

  public async matchLines(lines: ReadonlyArray<string>, min = 2, token?: CancellationToken): Promise<Set<string> | undefined> {
    let res: Set<string> = new Set()
    let ts = Date.now()
    for (let line of lines) {
      if (line.length === 0) continue
      let str = ''
      if (Date.now() - ts > 15) {
        await waitImmediate()
        ts = Date.now()
      }
      for (let codePoint of line) {
        if (token && token.isCancellationRequested) return undefined
        let code = codePoint.codePointAt(0)
        let isKeyword = this.isKeywordCode(code)
        if (isKeyword) {
          str = str + codePoint
        } else {
          if (str.length > 0) {
            if (str.length >= min && str.length < 48) res.add(str)
            str = ''
          }
        }
      }
      if (str.length >= min && str.length < 48) res.add(str)
    }
    return res
  }

  public async computeWordRanges(lines: ReadonlyArray<string>, range: Range, token?: CancellationToken): Promise<{ [word: string]: Range[] }> {
    let s = range.start.line
    let e = range.end.line
    let res: { [word: string]: Range[] } = {}
    let ts = Date.now()
    for (let i = s; i <= e; i++) {
      let text = lines[i]
      if (text === undefined) break
      let sc = i === s ? range.start.character : 0
      if (i === s) text = text.slice(sc)
      if (i === e) text = text.slice(0, range.end.character - sc)
      if (Date.now() - ts > 15) {
        if (token && token.isCancellationRequested) break
        await waitImmediate()
        ts = Date.now()
      }
      let start = -1
      const add = (end: number) => {
        let word = text.slice(start, end)
        let arr = hasOwnProperty(res, word) ? res[word] : []
        arr.push(Range.create(i, start + sc, i, end + sc))
        res[word] = arr
      }
      for (let i = 0, l = text.length; i < l; i++) {
        if (this.isKeywordChar(text[i])) {
          if (start == -1) {
            start = i
          }
        } else {
          if (start != -1) {
            add(i)
            start = -1
          }
        }
        if (i === l - 1 && start != -1) {
          add(l)
        }
      }
    }
    return res
  }
}
