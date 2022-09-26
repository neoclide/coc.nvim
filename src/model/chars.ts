'use strict'
import { CancellationToken, Position, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
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
        let arr = res[word] ?? []
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

  public getLocalifyBonus(sp: Position, ep: Position, lines: ReadonlyArray<string>, max = 10 * 1024): Map<string, number> {
    let res: Map<string, number> = new Map()
    let startLine = Math.max(0, sp.line - 50)
    let endLine = Math.min(lines.length, sp.line + 50)
    let content = lines.slice(startLine, endLine).join('\n')
    // limit content to parse
    if (content.length > max) {
      let len = content.length
      let finished = false
      while (endLine > sp.line + 1) {
        let length = lines[endLine - 1].length
        if (len - length < max) {
          finished = true
          break
        }
        endLine = endLine - 1
        len -= length
      }
      if (!finished) {
        while (startLine <= sp.line) {
          let length = lines[startLine].length
          if (len - length < max) {
            break
          }
          len -= length
          startLine += 1
        }
      }
      content = lines.slice(startLine, endLine).join('\n')
    }
    sp = Position.create(sp.line - startLine, sp.character)
    ep = Position.create(ep.line - startLine, ep.character)
    let doc = TextDocument.create('', '', 1, content)
    let headCount = doc.offsetAt(sp)
    let len = content.length
    let tailCount = len - doc.offsetAt(ep)
    let start = 0
    let preKeyword = false
    for (let i = 0; i < headCount; i++) {
      let iskeyword = this.isKeyword(content[i])
      if (!preKeyword && iskeyword) {
        start = i
      } else if (preKeyword && !iskeyword) {
        if (i - start > 1) {
          let str = content.substring(start, i)
          res.set(str, i / headCount)
        }
      }
      preKeyword = iskeyword
    }
    start = len - tailCount
    preKeyword = false
    for (let i = start; i < content.length; i++) {
      let iskeyword = this.isKeyword(content[i])
      if (!preKeyword && iskeyword) {
        start = i
      } else if (preKeyword && (!iskeyword || i == len - 1)) {
        if (i - start > 1) {
          let end = i == len - 1 ? i + 1 : i
          let str = content.substring(start, end)
          let score = res.get(str) || 0
          let n = len - i + (end - start)
          if (n !== tailCount) {
            res.set(str, Math.max(score, n / tailCount))
          }
        }
      }
      preKeyword = iskeyword
    }
    return res
  }
}
