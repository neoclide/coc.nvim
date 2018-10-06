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
        ranges.push(new Range(192, 255))
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
  public ranges: Range[]
  constructor(keywordOption: string) {
    this.ranges = Range.fromKeywordOption(keywordOption)
  }

  public addKeyword(ch: string): void {
    let c = ch.charCodeAt(0)
    let { ranges } = this
    if (!ranges.some(o => o.contains(c))) {
      ranges.push(new Range(c))
    }
  }

  public setKeywordOption(keywordOption: string): void {
    this.ranges = Range.fromKeywordOption(keywordOption)
  }

  public matchKeywords(content: string, min = 3): string[] {
    if (!content) return []
    let res: string[] = []
    let str = ''
    for (let i = 0, l = content.length; i < l; i++) {
      let ch = content[i]
      if ('-' == ch && str.length == 0) {
        continue
      }
      let isKeyword = this.isKeywordChar(ch)
      if (isKeyword) {
        str = str + ch
      }
      if (str.length >= min
        && res.indexOf(str) == -1
        && (i == l - 1 || !isKeyword)) {
        res.push(str)
      }
      if (!isKeyword) {
        str = ''
      }
    }
    return res
  }

  public isKeywordChar(ch: string): boolean {
    let { ranges } = this
    let c = ch.charCodeAt(0)
    if (c > 255) return false
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
