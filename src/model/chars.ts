'use strict'
import { CancellationToken, Range } from 'vscode-languageserver-protocol'
import { waitImmediate } from '../util'
const logger = require('../util/logger')('model-chars')

class CodeRange {
  public start: number
  public end: number
  constructor(start: number, end?: number) {
    this.start = start
    this.end = end ? end : start
  }

  public static fromKeywordOption(keywordOption: string): CodeRange[] {
    let parts = keywordOption.split(',')
    let ranges: CodeRange[] = []
    ranges.push(new CodeRange(65, 90))
    ranges.push(new CodeRange(97, 122))
    for (let part of parts) {
      if (part == '@') {
        ranges.push(new CodeRange(256, 65535))
      } else if (part == '@-@') {
        ranges.push(new CodeRange(64))
      } else if (/^\d+-\d+$/.test(part)) {
        let ms = part.match(/^(\d+)-(\d+)$/)
        ranges.push(new CodeRange(Number(ms[1]), Number(ms[2])))
      } else if (/^\d+$/.test(part)) {
        ranges.push(new CodeRange(Number(part)))
      } else {
        let c = part.charCodeAt(0)
        if (!ranges.some(o => o.contains(c))) {
          ranges.push(new CodeRange(c))
        }
      }
    }
    return ranges
  }

  public contains(c: number): boolean {
    return c >= this.start && c <= this.end
  }
}

export class Chars {
  public ranges: CodeRange[] = []
  constructor(keywordOption: string) {
    this.ranges = CodeRange.fromKeywordOption(keywordOption)
  }

  public addKeyword(ch: string): void {
    let c = ch.charCodeAt(0)
    let { ranges } = this
    if (!ranges.some(o => o.contains(c))) {
      ranges.push(new CodeRange(c))
    }
  }

  public clone(): Chars {
    let chars = new Chars('')
    chars.ranges = this.ranges.slice()
    return chars
  }

  public setKeywordOption(keywordOption: string): void {
    this.ranges = CodeRange.fromKeywordOption(keywordOption)
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

  public isKeywordCode(code: number): boolean {
    if (code > 255) return true
    if (code < 33) return false
    return this.ranges.some(r => r.contains(code))
  }

  public isKeywordChar(ch: string): boolean {
    let { ranges } = this
    if (/\s/.test(ch)) return false
    let c = ch.charCodeAt(0)
    if (c < 33) return false
    return ranges.some(r => r.contains(c))
  }

  public isKeyword(word: string): boolean {
    for (let i = 0, l = word.length; i < l; i++) {
      if (!this.isKeywordChar(word[i])) return false
    }
    return true
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
        let arr = Object.hasOwnProperty.call(res, word) ? res[word] : []
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
