'use strict'
import { Range } from 'vscode-languageserver-types'
import { waitImmediate } from '../util'
import { intable } from '../util/array'
import { hasOwnProperty } from '../util/object'
import { CancellationToken } from '../util/protocol'
import { isHighSurrogate } from '../util/string'

// Word ranges from vim, tested by '\k' option when '@' in iskeyword option.
const WORD_RANGES: [number, number][] = [[257, 893], [895, 902], [904, 1369], [1376, 1416], [1418, 1469], [1471, 1471], [1473, 1474], [1476, 1522], [1525, 1547], [1549, 1562], [1564, 1566], [1568, 1641], [1646, 1747], [1749, 1791], [1806, 2403], [2406, 2415], [2417, 3571], [3573, 3662], [3664, 3673], [3676, 3843], [3859, 3897], [3902, 3972], [3974, 4169], [4176, 4346], [4348, 4960], [4969, 5740], [5743, 5759], [5761, 5786], [5789, 5866], [5870, 5940], [5943, 6099], [6109, 6143], [6155, 8191], [10240, 10495], [10649, 10711], [10716, 10747], [10750, 11775], [11904, 12287], [12321, 12335], [12337, 12348], [12350, 64829], [64832, 65071], [65132, 65279], [65296, 65305], [65313, 65338], [65345, 65370], [65382, 65535]]

const MAX_CODE_UNIT = 65535

const chineseRegex = /[\u4e00-\u9fa5]/
const boundary = 19968

export function getCharCode(str: string): number | undefined {
  if (/^\d+$/.test(str)) return parseInt(str, 10)
  if (str.length > 0) return str.charCodeAt(0)
  return undefined
}

export function sameScope(a: number, b: number): boolean {
  if (a < boundary) return b < boundary
  return b >= boundary
}

export function* chineseSegments(text: string): Iterable<string> {
  if (Intl === undefined || typeof Intl['Segmenter'] !== 'function') {
    yield text
    return
  }
  let res: string[] = []
  let items = new Intl['Segmenter']('cn', { granularity: 'word' }).segment(text)
  for (let item of items) {
    if (item.isWordLike) {
      yield item.segment
    }
  }
  return res
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
    if (isHighSurrogate(code)) return false
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

  public *iterateWords(text: string): Iterable<[number, number]> {
    let start = -1
    let prevCode: number | undefined
    for (let i = 0, l = text.length; i < l; i++) {
      let code = text.charCodeAt(i)
      if (this.isKeywordCode(code)) {
        if (start == -1) {
          start = i
        } else if (prevCode !== undefined && !sameScope(prevCode, code)) {
          yield [start, i]
          start = i
        }
      } else {
        if (start != -1) {
          yield [start, i]
          start = -1
        }
      }
      if (i === l - 1 && start != -1) {
        yield [start, i + 1]
      }
      prevCode = code
    }
  }

  public matchLine(line: string, min = 2, max = 1024): string[] {
    let res: Set<string> = new Set()
    let l = line.length
    if (l > max) {
      line = line.slice(0, max)
      l = max
    }
    for (let [start, end] of this.iterateWords(line)) {
      if (end - start < min) continue
      let word = line.slice(start, end)
      if (chineseRegex.test(word[0])) {
        for (let text of chineseSegments(word)) {
          res.add(text)
        }
      } else {
        res.add(word)
      }
    }
    return Array.from(res)
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
      for (let [start, end] of this.iterateWords(text)) {
        let word = text.slice(start, end)
        let arr = hasOwnProperty(res, word) ? res[word] : []
        arr.push(Range.create(i, start + sc, i, end + sc))
        res[word] = arr
      }
    }
    return res
  }
}
