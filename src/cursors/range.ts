import { Position, Range, TextEdit } from 'vscode-languageserver-types'
import { comparePosition } from '../util/position'
const logger = require('../util/logger')('cursors-range')

// edit range
export default class TextRange {
  private currStart: number
  private currEnd: number

  constructor(public line: number,
    public start: number,
    public end: number,
    public text: string,
    // range count at this line before, shuld be updated on range add
    public preCount: number) {
    this.currStart = start
    this.currEnd = end
  }

  public add(offset: number, add: string): void {
    let { text, preCount } = this
    let pre = offset == 0 ? '' : text.slice(0, offset)
    let post = text.slice(offset)
    this.text = `${pre}${add}${post}`
    this.currStart = this.currStart + preCount * add.length
    this.currEnd = this.currEnd + (preCount + 1) * add.length
  }

  public replace(begin: number, end: number, add = ''): void {
    let { text, preCount } = this
    let pre = begin == 0 ? '' : text.slice(0, begin)
    let post = text.slice(end)
    this.text = pre + add + post
    let l = end - begin - add.length
    this.currStart = this.currStart - preCount * l
    this.currEnd = this.currEnd - (preCount + 1) * l
  }

  public get range(): Range {
    return Range.create(this.line, this.start, this.line, this.end)
  }

  public get currRange(): Range {
    return Range.create(this.line, this.currStart, this.line, this.currEnd)
  }

  public applyEdit(edit: TextEdit): void {
    let { range, newText } = edit
    let start = range.start.character
    let end = range.end.character
    let isAdd = start == end
    if (isAdd) {
      this.add(start - this.currStart, newText)
    } else {
      this.replace(start - this.currStart, end - this.currStart, newText)
    }
  }

  /**
   * Adjust from textEdit that not overlap
   */
  public adjustFromEdit(edit: TextEdit): void {
    let { range, newText } = edit
    // no change if edit after current range
    if (comparePosition(range.start, Position.create(this.line, this.currEnd)) > 0) {
      return
    }
    let newLines = newText.split('\n')
    let changeCount = newLines.length - (range.end.line - range.start.line + 1)
    this.line = this.line + changeCount
    if (range.end.line == this.line) {
      let remove = range.start.line == range.end.line ? range.end.character - range.start.character : range.end.character
      if (newLines.length > 1 && range.start.line == range.end.line) {
        remove = remove + range.start.character
      }
      let add = 0
      if (newLines.length > 1) {
        add = newLines[newLines.length - 1].length
      } else {
        if (range.start.line == range.end.line) {
          add = newText.length
        } else {
          add = range.start.character + newText.length
        }
      }
      let delta = add - remove
      for (let key of ['start', 'end', 'currStart', 'currEnd']) {
        this[key] += delta
      }
    }
  }

  public sync(): void {
    this.start = this.currStart
    this.end = this.currEnd
  }

  public get textEdit(): TextEdit {
    return {
      range: this.range,
      newText: this.text
    }
  }
}
