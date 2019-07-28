import { Range, TextEdit } from 'vscode-languageserver-types'
const logger = require('../util/logger')('cursors-range')

// edit range
export default class TextRange {
  private currStart: number
  private currEnd: number

  constructor(public line: number,
    public readonly start: number,
    public readonly end: number,
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

  public get textEdit(): TextEdit {
    return {
      range: this.range,
      newText: this.text
    }
  }
}
