const logger = require('../util/logger')('model-chars')

export class Range {
  public start: number
  public end: number
  constructor(start: number, end?: number) {
    this.start = start
    this.end = end ? end : start
  }

  public static fromKeywordOption(keywordOption: string): Range[] {
    let parts = keywordOption.split(',')
    let ranges: Range[] = []
    for (let part of parts) {
      if (part == '@') {
        // isalpha() of c
        ranges.push(new Range(65, 90))
        ranges.push(new Range(97, 122))
      } else if (part == '@-@') {
        ranges.push(new Range(64))
      } else if (/^([A-Za-z])-([A-Za-z])$/.test(part)) {
        let ms = part.match(/^([A-Za-z])-([A-Za-z])$/)
        ranges.push(new Range(ms[1].charCodeAt(0), ms[2].charCodeAt(0)))
      } else if (/^\d+-\d+$/.test(part)) {
        let ms = part.match(/^(\d+)-(\d+)$/)
        ranges.push(new Range(Number(ms[1]), Number(ms[2])))
      } else if (/^\d+$/.test(part)) {
        ranges.push(new Range(Number(part)))
      } else {
        let c = part.charCodeAt(0)
        if (!ranges.some(o => o.contains(c))) {
          ranges.push(new Range(c))
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
  public ranges: Range[] = []
  constructor(keywordOption?: string) {
    if (keywordOption) this.ranges = Range.fromKeywordOption(keywordOption)
  }

  public addKeyword(ch: string): void {
    let c = ch.charCodeAt(0)
    let { ranges } = this
    if (!ranges.some(o => o.contains(c))) {
      ranges.push(new Range(c))
    }
  }

  public clone(): Chars {
    let chars = new Chars()
    chars.ranges = this.ranges.slice()
    return chars
  }

  public setKeywordOption(keywordOption: string): void {
    this.ranges = Range.fromKeywordOption(keywordOption)
  }

  public matchKeywords(content: string, min = 3): string[] {
    let length = content.length
    if (length == 0) return []
    let res: Set<string> = new Set()
    let str = ''
    let len = 0
    for (let i = 0; i < length; i++) {
      let ch = content[i]
      let code = ch.codePointAt(0)
      if (len == 0 && code == 45) continue
      let isKeyword = this.isKeywordCode(code)
      if (isKeyword) {
        if (len == 48) continue
        str = str + ch
        len = len + 1
      } else {
        if (len >= min && len < 48) res.add(str)
        str = ''
        len = 0
      }
    }
    if (len != 0) res.add(str)
    return Array.from(res)
  }

  public isKeywordCode(code: number): boolean {
    if (code > 255) return true
    if (code < 33) return false
    return this.ranges.some(r => r.contains(code))
  }

  public isKeywordChar(ch: string): boolean {
    let { ranges } = this
    let c = ch.charCodeAt(0)
    if (c > 255) return true
    if (c < 33) return false
    return ranges.some(r => r.contains(c))
  }

  public isKeyword(word: string): boolean {
    let { ranges } = this
    for (let i = 0, l = word.length; i < l; i++) {
      let ch = word.charCodeAt(i)
      // for speed
      if (ch > 255) return false
      if (ranges.some(r => r.contains(ch))) continue
      return false
    }
    return true
  }
}
